#!/usr/bin/env python
"""Nightjar wake daemon — the live, always-on voice loop Phase 2 deferred and
Phase 4 built the UI/orb for, but which never actually existed as running code.

Prior state (confirmed before this file existed): `wakeword.py` was a detector
that only scanned prerecorded WAV files/arrays; `mcp_server.py`'s
`wake_word_listen` is an MCP *tool* the agent can call with a file path, not an
autonomous background listener; nothing tied wake -> transcribe -> an OpenCode
prompt -> a spoken reply together. This script is that missing piece.

Loop: capture the live microphone (a `parec` subprocess — no new heavy audio
dependency; matches nightjar_capabilities/voice.py's existing "no
sounddevice/pyaudio" stance) -> score every 80ms frame with openWakeWord
-> on wake, publish `wake`, record a fixed follow-up window, transcribe with
faster-whisper, publish `transcription` -> POST the command to a persistent
OpenCode session (agent=NIGHTJAR_AGENT, default "assistant") and collect the
reply off the real SSE event stream -> synthesize the reply with kokoro-onnx,
publish `tts` -> back to listening. Every event kind/shape matches what
mcp_server.py already publishes, so NightjarOrb (Phase 4) animates identically
whether the event came from an agent tool call or this daemon.

Known, explicitly-accepted limitations (not silently hidden):
- Command-window endpointing is a fixed window (COMMAND_WINDOW_S), not VAD —
  the same "naive, needs work" gap phase2-mcp/PHASE2_REPORT.md already flagged.
- No acoustic echo cancellation: wake-scoring is paused while a reply plays
  back, so the daemon can't hear its own TTS output and re-trigger on it — but
  it also means it can't hear you barge in over a reply.
- Uses the STOCK wake-word model unless NIGHTJAR_WAKEWORD_MODEL points at a
  trained hey_nightjar.onnx (none exists yet — see wakeword_training/README.md).

Run: python wake_daemon.py
Env: NIGHTJAR_OPENCODE_URL (default http://127.0.0.1:4096), NIGHTJAR_AGENT
     (default "assistant"), NIGHTJAR_WAKEWORD_MODEL (optional custom .onnx),
     NIGHTJAR_TTS_VOICE (default af_heart), NIGHTJAR_PLAY_TTS=1 to also play
     the reply locally via `paplay` (useful without the Electron UI running).
"""
from __future__ import annotations

import json
import os
import queue
import socket
import subprocess
import sys
import threading
import time
from typing import Optional

import numpy as np
import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nightjar_capabilities import config, voice as _voice, wakeword as _wakeword
import sidechannel

SR = _wakeword.SR              # 16000
FRAME = _wakeword.FRAME        # 1280 samples = 80ms @ 16kHz
BYTES_PER_FRAME = FRAME * 2    # int16 mono

COMMAND_WINDOW_S = float(os.environ.get("NIGHTJAR_COMMAND_WINDOW_S", "4.0"))
WAKE_COOLDOWN_S = 1.0
MIC_READ_TIMEOUT_S = 5.0       # a live frame must arrive within this long
MIC_RESTART_LIMIT = 3
OPENCODE_URL = os.environ.get("NIGHTJAR_OPENCODE_URL", "http://127.0.0.1:4096")
AGENT = os.environ.get("NIGHTJAR_AGENT", "assistant")
MODEL = os.environ.get("NIGHTJAR_MODEL", "llamacpp/qwen3-4b-instruct-2507")
TURN_TIMEOUT_S = float(os.environ.get("NIGHTJAR_TURN_TIMEOUT_S", "90"))
TTS_TIMEOUT_S = float(os.environ.get("NIGHTJAR_TTS_TIMEOUT_S", "30"))
TTS_VOICE = os.environ.get("NIGHTJAR_TTS_VOICE", "af_heart")
PLAY_TTS_LOCALLY = os.environ.get("NIGHTJAR_PLAY_TTS", "0") == "1"
HEALTH_PORT = int(os.environ.get("NIGHTJAR_WAKE_HEALTH_PORT", "8766"))

WAKE_PHRASES = ("hey nightjar", "hey jarvis")  # stripped if the transcript leads with either


def log(msg: str) -> None:
    print(f"[wake-daemon] {msg}", flush=True)


# ─── live mic capture (parec subprocess; no new heavy audio dependency) ───────

class MicStream:
    def __init__(self, device: Optional[str] = None) -> None:
        # device: explicit PulseAudio source name (env NIGHTJAR_MIC_DEVICE), else
        # the system default input — override lets a test drive a loopback sink.
        self._device = device or os.environ.get("NIGHTJAR_MIC_DEVICE")
        self._proc: Optional[subprocess.Popen] = None
        self._restarts = 0
        self._start()

    def _start(self) -> None:
        cmd = ["parec", "--format=s16le", f"--rate={SR}", "--channels=1", "--raw"]
        if self._device:
            cmd.append(f"--device={self._device}")
        self._proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            bufsize=0,
        )

    def _read_exact(self, n: int) -> bytes:
        buf = b""
        deadline = time.monotonic() + MIC_READ_TIMEOUT_S
        while len(buf) < n:
            if time.monotonic() > deadline:
                raise TimeoutError(f"mic read stalled >{MIC_READ_TIMEOUT_S}s (parec dead/frozen)")
            chunk = self._proc.stdout.read(n - len(buf))
            if not chunk:
                raise EOFError("parec stdout closed")
            buf += chunk
            deadline = time.monotonic() + MIC_READ_TIMEOUT_S  # got bytes; reset stall clock
        return buf

    def read_frame(self) -> np.ndarray:
        """Read one FRAME-sample int16 mono frame, restarting parec (bounded) on failure."""
        while True:
            try:
                raw = self._read_exact(BYTES_PER_FRAME)
                return np.frombuffer(raw, dtype=np.int16)
            except (TimeoutError, EOFError) as e:
                self._restarts += 1
                if self._restarts > MIC_RESTART_LIMIT:
                    raise RuntimeError(f"mic capture failed {self._restarts}x: {e}") from e
                log(f"mic capture error ({e}); restarting parec (attempt {self._restarts})")
                self.close()
                self._start()

    def close(self) -> None:
        if self._proc:
            self._proc.kill()
            self._proc.wait(timeout=5)
            self._proc = None


# ─── side-channel publish (best-effort, mirrors mcp_server.py's _publish) ────

def publish(kind: str, **fields) -> None:
    sidechannel.publish({"kind": kind, **fields})


# ─── OpenCode turn: persistent session + SSE listener thread ─────────────────

class OpenCodeVoice:
    """A persistent OpenCode session + background SSE reader, so each wake only
    has to POST a prompt and wait on a queue — no reconnect-per-turn cost."""

    def __init__(self, base_url: str, agent: str, model: str):
        self.base_url = base_url.rstrip("/")
        self.agent = agent
        self.model = model
        self.session_id = self._create_session()
        self._q: "queue.Queue[dict]" = queue.Queue()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._sse_loop, daemon=True)
        self._thread.start()

    def _create_session(self) -> str:
        r = requests.post(f"{self.base_url}/session", json={"title": "Nightjar voice"}, timeout=10)
        r.raise_for_status()
        return r.json()["id"]

    def _sse_loop(self) -> None:
        while not self._stop.is_set():
            try:
                with requests.get(f"{self.base_url}/event", stream=True, timeout=(10, None)) as resp:
                    resp.raise_for_status()
                    buf = ""
                    for chunk in resp.iter_content(chunk_size=None, decode_unicode=True):
                        if self._stop.is_set():
                            return
                        if not chunk:
                            continue
                        buf += chunk
                        while "\n\n" in buf:
                            frame, buf = buf.split("\n\n", 1)
                            data_lines = [l[5:].strip() for l in frame.split("\n") if l.startswith("data:")]
                            if not data_lines:
                                continue
                            try:
                                ev = json.loads("\n".join(data_lines))
                            except ValueError:
                                continue
                            self._q.put(ev)
            except requests.RequestException as e:
                log(f"SSE stream dropped ({e}); reconnecting in 2s")
                time.sleep(2)

    def prompt_and_wait(self, text: str, timeout_s: float) -> str:
        """POST a prompt under `agent`, then collect streamed text until
        session.idle/session.error or the hard timeout. Returns the reply text
        (possibly partial/empty on timeout — never blocks past timeout_s)."""
        slash = self.model.find("/")
        model_ref = {"providerID": self.model[:slash], "modelID": self.model[slash + 1:]} if slash > 0 else None
        r = requests.post(
            f"{self.base_url}/session/{self.session_id}/prompt_async",
            json={"agent": self.agent, **({"model": model_ref} if model_ref else {}),
                  "parts": [{"type": "text", "text": text}]},
            timeout=10,
        )
        if r.status_code not in (200, 204):
            raise RuntimeError(f"prompt_async -> {r.status_code}: {r.text[:300]}")

        deadline = time.monotonic() + timeout_s
        # Text parts belong to a messageID, and the stream carries BOTH the
        # user's own echoed message and the assistant's reply — filtering by
        # role is required or the "reply" ends up being the prompt text plus
        # the real answer concatenated together (caught in testing: see
        # KNOWN_ISSUES.md if this regresses). message_role is populated from
        # message.updated (info.role); a part is only kept once its owning
        # message resolves to role=="assistant".
        message_role: dict[str, str] = {}
        part_owner: dict[str, str] = {}
        parts: dict[str, str] = {}
        part_order: list[str] = []
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                log(f"turn timed out after {timeout_s}s — replying with partial text so far")
                break
            try:
                ev = self._q.get(timeout=min(remaining, 1.0))
            except queue.Empty:
                continue
            p = ev.get("properties") or {}
            sid = p.get("sessionID") or (p.get("info") or {}).get("sessionID") or (p.get("part") or {}).get("sessionID")
            if sid != self.session_id:
                continue
            et = ev.get("type")
            if et == "message.updated" and p.get("info"):
                message_role[p["info"]["id"]] = p["info"].get("role")
            elif et == "message.part.updated" and (p.get("part") or {}).get("type") == "text":
                part = p["part"]
                part_owner[part["id"]] = part["messageID"]
                if part["id"] not in parts:
                    part_order.append(part["id"])
                parts[part["id"]] = part.get("text", "")
            elif et == "message.part.delta" and p.get("field") == "text":
                pid = p["partID"]
                if pid not in parts:
                    part_order.append(pid)
                parts[pid] = parts.get(pid, "") + (p.get("delta") or "")
            elif et in ("session.idle", "turn.idle"):
                break
            elif et == "session.error":
                log(f"session.error during turn: {p.get('error')}")
                break
        return "".join(
            parts[pid] for pid in part_order
            if message_role.get(part_owner.get(pid, "")) == "assistant"
        )

    def close(self) -> None:
        self._stop.set()


# ─── one full wake -> reply turn ──────────────────────────────────────────────

def strip_wake_phrase(transcript: str) -> str:
    low = transcript.lower()
    for w in WAKE_PHRASES:
        if low.startswith(w):
            return transcript[len(w):].lstrip(" ,.").strip()
    return transcript


def handle_wake(mic: MicStream, oc: OpenCodeVoice, max_score: float) -> None:
    log(f"WAKE detected (score={max_score:.3f}) — capturing {COMMAND_WINDOW_S}s command window")
    publish("wake", detected=True, max_score=round(max_score, 4))

    n_frames = int(COMMAND_WINDOW_S * SR / FRAME)
    frames = [mic.read_frame() for _ in range(n_frames)]
    pcm = np.concatenate(frames)

    # voice.transcribe's ndarray path expects PRE-NORMALIZED float32 in [-1,1]
    # (its bytes path does the int16->float32 conversion instead) — pass raw
    # bytes so the one already-tested conversion path handles it.
    transcript = _voice.transcribe(pcm.tobytes())
    cmd = strip_wake_phrase(transcript)
    log(f"transcribed: {transcript!r} -> command: {cmd!r}")
    publish("transcription", text=cmd, final=True)

    if not cmd:
        log("empty command after wake; returning to listening")
        return

    try:
        reply = oc.prompt_and_wait(cmd, TURN_TIMEOUT_S)
    except Exception as e:  # noqa: BLE001 — a bad turn must not kill the daemon
        log(f"OpenCode turn failed: {e}")
        return
    if not reply.strip():
        log("no reply text produced; skipping TTS")
        return
    log(f"reply: {reply!r}")

    tts_result: dict = {}
    def _synth():
        tts_result["path"] = _voice.speak(reply, voice=TTS_VOICE)
    t = threading.Thread(target=_synth, daemon=True)
    t.start()
    t.join(timeout=TTS_TIMEOUT_S)
    if "path" not in tts_result:
        log(f"TTS synth exceeded {TTS_TIMEOUT_S}s timeout; not publishing (it may still finish in the background)")
        return
    path = tts_result["path"]
    log(f"speaking: {path}")
    publish("tts", state="ready", path=path, text=reply)
    if PLAY_TTS_LOCALLY:
        subprocess.run(["paplay", path], check=False)


# ─── main loop ────────────────────────────────────────────────────────────────

def _start_health_server() -> None:
    """Bind-and-accept-only TCP listener so the Electron supervisor's tcpOpen
    probe (the same pattern it already uses for the side-channel) gets a real
    liveness signal for this daemon, instead of a fake timed probe."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", HEALTH_PORT))
    srv.listen(5)

    def serve():
        while True:
            try:
                conn, _ = srv.accept()
                conn.close()
            except OSError:
                return

    threading.Thread(target=serve, daemon=True).start()


def main() -> None:
    config.ensure_dirs()
    _start_health_server()
    log(f"connecting OpenCode session at {OPENCODE_URL} (agent={AGENT}, model={MODEL})")
    oc = OpenCodeVoice(OPENCODE_URL, AGENT, MODEL)
    log(f"session {oc.session_id} ready")

    detector = _wakeword.WakeWordDetector()
    if not detector.is_custom:
        log(f"⚠️  STOCK wake model in use ('{detector.model_key}') — say the stock phrase, "
            f"not 'Hey Nightjar', until a trained hey_nightjar.onnx is deployed "
            f"(see wakeword_training/README.md)")

    mic = MicStream()
    log("listening (live mic, real openWakeWord inference on every 80ms frame)…")
    try:
        while True:
            frame = mic.read_frame()
            score = detector.process_frame(frame)
            if score >= detector.threshold:
                handle_wake(mic, oc, score)
                detector.reset()
                time.sleep(WAKE_COOLDOWN_S)
    except KeyboardInterrupt:
        log("stopping (KeyboardInterrupt)")
    finally:
        mic.close()
        oc.close()


if __name__ == "__main__":
    main()
