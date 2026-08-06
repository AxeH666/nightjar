#!/usr/bin/env python
"""Nightjar wake daemon — the live, always-on voice loop Phase 2 deferred and
Phase 4 built the UI/orb for, but which never actually existed as running code.

Prior state (confirmed before this file existed): `wakeword.py` was a detector
that only scanned prerecorded WAV files/arrays; `mcp_server.py`'s
`wake_word_listen` is an MCP *tool* the agent can call with a file path, not an
autonomous background listener; nothing tied wake -> transcribe -> an OpenCode
prompt -> a spoken reply together. This script is that missing piece.

Loop: capture the live microphone (sounddevice/PortAudio — the cross-platform
path, REQUIRED on native Windows; `parec` remains as the PulseAudio fallback
where PortAudio is absent — voice-phase PR 3) -> score every 120ms hop with the
onnxruntime wake pipeline -> on wake, publish `wake`, record a fixed follow-up window,
transcribe with faster-whisper, publish `transcription` -> POST the command to
a persistent OpenCode session (agent=NIGHTJAR_AGENT, default "assistant") and
collect the reply off the real SSE event stream -> synthesize the reply with
kokoro-onnx, publish `tts` -> back to listening. Every event kind/shape matches
what mcp_server.py already publishes, so NightjarOrb (Phase 4) animates
identically whether the event came from an agent tool call or this daemon.

Known, explicitly-accepted limitations (not silently hidden):
- Command-window endpointing is a fixed window (COMMAND_WINDOW_S), not VAD —
  the same "naive, needs work" gap phase2-mcp/PHASE2_REPORT.md already flagged.
- No acoustic echo cancellation: wake-scoring is MUTED while a reply plays back
  (voice-phase PR 4 — driven by the renderer's real `tts playing`/`ended`
  events, with a wall-clock backstop), so the daemon can't hear its own TTS
  through the speakers and re-trigger on it — but it also means you cannot
  barge in over a reply. Barge-in is explicitly out of scope.
- Uses the INTERIM stand-in wake model unless NIGHTJAR_WAKEWORD_MODEL points at a
  trained hey_june.onnx (none exists yet — see wakeword_training/README.md), so
  the phrase is "hey buddy", not "hey june". Voice-phase PR 5 moved the engine
  from openWakeWord to hey-buddy, which removed the CC-BY-NC-SA (non-commercial)
  artifacts entirely (NJ-58); the stand-in's remaining encumbrance is narrower and
  named (NJ-59). The custom synthetic model is still what makes a paid build
  legal — it is not a cosmetic rename.

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
import shutil
import socket
import subprocess
import sys
import threading
import time
from typing import Callable, Optional

import numpy as np
import requests

# NJ-79: force UTF-8 on our own stdio, BEFORE anything can print.
#
# Python picks stdout's encoding from whether stdout is a console. Under a real terminal on
# Windows it is `_WindowsConsoleIO` at utf-8 and everything works; when the SUPERVISOR spawns
# us the streams are PIPES, so Python falls back to the locale ANSI codepage — cp1252 on a
# typical Windows box. A single non-cp1252 character in a log line then raises
# UnicodeEncodeError out of print(), which nothing catches, and the daemon dies before it ever
# reaches the mic loop. That is exactly what happened: five crash-restarts, then `failed`.
#
# This is why it survived every prior test — run this file by hand in a terminal and it works
# perfectly. Only the piped path breaks, so only the app could ever hit it.
#
# errors="replace" is deliberate, not laziness: a LOG LINE MUST NEVER BE ABLE TO KILL THIS
# PROCESS. Strict would merely relocate the crash to the next unmappable character.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        # Not a TextIOWrapper (redirected oddly, or already detached) — leave it alone. The
        # supervisor also sets PYTHONIOENCODING=utf-8, which covers us either way.
        pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nightjar_capabilities import config, voice as _voice, wakeword as _wakeword
import sidechannel

SR = _wakeword.SR              # 16000
FRAME = _wakeword.FRAME        # 1920 samples = 120ms @ 16kHz (hey-buddy's hop; was
                               # 1280/80ms under openWakeWord — voice-phase PR 5)
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

# Stripped if the transcript leads with one. "hey june" is the product phrase (its
# trained model is still pending); "hey buddy" is what the interim stand-in actually
# responds to; "hey nightjar" is the legacy product name. "hey jarvis" was dropped in
# voice-phase PR 5 along with openWakeWord — nothing answers to it any more.
# Keep in sync with mcp_server.py's copy.
WAKE_PHRASES = ("hey june", "hey buddy", "hey nightjar")


def log(msg: str) -> None:
    print(f"[wake-daemon] {msg}", flush=True)


# ─── live mic capture (sounddevice/PortAudio primary; parec fallback) ─────────
# Voice-phase PR 3: parec (PulseAudio) was the ONLY backend, so capture was dead on
# native Windows — the whole voice path silently didn't exist there (NJ-57's "inert
# by missing binary"). sounddevice/PortAudio (WASAPI/DirectSound/ALSA/CoreAudio) is
# now the primary path on every OS; parec stays as the fallback where PortAudio is
# absent. Selection is deterministic and LOGGED; no backend at all is a loud
# RuntimeError naming both failures (visible in the supervisor health strip), never
# a silent no-op (rule 8).

SILENCE_HINT_S = float(os.environ.get("NIGHTJAR_SILENCE_HINT_S", "10.0"))

# Hard cap on how long a single playback may mute wake scoring (rule 3). Deliberately
# LONGER than the orb's own speakingTimeoutMs (60s, orbAdapter.ts) so the renderer's
# watchdog normally publishes `ended` first; this only fires if that event is lost
# (renderer crash, side-channel drop mid-clip). Without it, one missing `ended` would
# deafen June permanently — a stuck mute is as bad as no mute.
PLAYBACK_MUTE_MAX_S = float(os.environ.get("NIGHTJAR_PLAYBACK_MUTE_MAX_S", "90.0"))


def sounddevice_available() -> tuple[bool, str]:
    """Import-probe sounddevice/PortAudio. Returns (ok, detail-for-errors)."""
    try:
        import sounddevice  # noqa: F401 — the import itself loads the PortAudio DLL

        return True, ""
    except Exception as e:  # noqa: BLE001 — missing wheel OR missing/broken PortAudio lib
        return False, f"{type(e).__name__}: {e}"


def select_mic_backend(force: Optional[str], sd_ok: bool, parec_ok: bool,
                       sd_detail: str = "") -> str:
    """Pure backend choice (unit-tested offline). NIGHTJAR_MIC_BACKEND forces one
    (its open-failure then surfaces at start time); otherwise sounddevice wins,
    parec is the fallback, and NO backend is a hard, named error."""
    if force in ("sounddevice", "parec"):
        return force
    if force:
        raise RuntimeError(f"NIGHTJAR_MIC_BACKEND={force!r} is not a backend (use 'sounddevice' or 'parec')")
    if sd_ok:
        return "sounddevice"
    if parec_ok:
        return "parec"
    raise RuntimeError(
        "no usable mic backend: sounddevice/PortAudio failed "
        f"({sd_detail or 'not importable'}) and `parec` (PulseAudio) is not on PATH. "
        "Install PortAudio via `pip install sounddevice` (bundled DLL on Windows/macOS; "
        "libportaudio2 on Linux) or PulseAudio for parec."
    )


def is_digital_silence(frame: np.ndarray) -> bool:
    """True for an ALL-ZERO frame — the Windows mic-privacy-off signature: a denied
    desktop app gets silent zeros from WASAPI, not an error (the NJ-37 silent-failure
    shape, in capture form). Real mics always carry ≥1 LSB of noise floor."""
    return frame.size == 0 or int(np.abs(frame).max()) == 0


class SilenceTracker:
    """Detects a CONTINUOUSLY all-zero capture stream and says so once per silent
    run. update() returns True exactly when the hint should be logged — after
    `hint_after_s` of unbroken digital silence; any real sample resets the run
    (and re-arms the hint for a later silent run). Clock injectable for tests."""

    def __init__(self, hint_after_s: float = SILENCE_HINT_S,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._hint_after_s = hint_after_s
        self._clock = clock
        self._silent_since: Optional[float] = None
        self._hinted = False

    def update(self, frame: np.ndarray) -> bool:
        if not is_digital_silence(frame):
            self._silent_since = None
            self._hinted = False
            return False
        now = self._clock()
        if self._silent_since is None:
            self._silent_since = now
            return False
        if not self._hinted and now - self._silent_since >= self._hint_after_s:
            self._hinted = True
            return True
        return False


SILENCE_HINT_MSG = (
    # NJ-79: ASCII "WARNING:", not an emoji. This particular message is the one that MUST
    # survive a hostile encoding: it exists to tell the user their microphone is DENIED, so
    # crashing here would mean dying inside the explanation of why the mic isn't working.
    f"WARNING: mic delivers ONLY silence (all-zero frames for {int(SILENCE_HINT_S)}s+). "
    "On Windows this is what a DENIED microphone looks like — check Settings → "
    "Privacy & security → Microphone → 'Let desktop apps access your microphone' "
    "(a denied app gets silent zeros, not an error). Also confirm the intended "
    "input device is the default, or set NIGHTJAR_MIC_DEVICE."
)


class MicStream:
    """Live 16 kHz mono int16 capture, one FRAME (80 ms) per read_frame().

    device: explicit input (env NIGHTJAR_MIC_DEVICE) — a PortAudio device index or
    name (substring) for sounddevice, a PulseAudio source name for parec; else the
    system default. Restarts the active backend (bounded) on stall/EOF."""

    def __init__(self, device: Optional[str] = None) -> None:
        self._device = device or os.environ.get("NIGHTJAR_MIC_DEVICE")
        sd_ok, sd_detail = sounddevice_available()
        self.backend = select_mic_backend(
            os.environ.get("NIGHTJAR_MIC_BACKEND"), sd_ok, shutil.which("parec") is not None, sd_detail)
        log(f"mic backend: {self.backend}")
        self._restarts = 0
        self._silence = SilenceTracker()
        self._proc: Optional[subprocess.Popen] = None          # parec
        self._sd_stream = None                                  # sounddevice
        self._sd_q: Optional["queue.Queue[bytes]"] = None
        self._start()

    # ── backend lifecycle ──────────────────────────────────────────────────────
    def _start(self) -> None:
        if self.backend == "sounddevice":
            self._start_sounddevice()
        else:
            self._start_parec()

    def _start_sounddevice(self) -> None:
        import sounddevice as sd

        q: "queue.Queue[bytes]" = queue.Queue(maxsize=64)

        def _cb(indata, _frames, _time_info, status) -> None:
            # PortAudio callback thread: copy the CFFI buffer out immediately (it is
            # reused after return). On overflow drop the OLDEST frame — wake scoring
            # needs a live stream, not history. `status` (over/underflow) is normal
            # under load; the stall clock in read_frame owns real failures.
            data = bytes(indata)
            try:
                q.put_nowait(data)
            except queue.Full:
                try:
                    q.get_nowait()
                    q.put_nowait(data)
                except queue.Empty:
                    pass

        device: Optional[object] = None
        if self._device:
            try:
                device = int(self._device)
            except ValueError:
                device = self._device  # sounddevice resolves name substrings itself
        self._sd_stream = sd.RawInputStream(
            samplerate=SR, blocksize=FRAME, channels=1, dtype="int16",
            device=device, callback=_cb,
        )
        self._sd_stream.start()
        self._sd_q = q

    def _start_parec(self) -> None:
        cmd = ["parec", "--format=s16le", f"--rate={SR}", "--channels=1", "--raw"]
        if self._device:
            cmd.append(f"--device={self._device}")
        self._proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            bufsize=0,
        )

    # ── reads ──────────────────────────────────────────────────────────────────
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

    def _read_backend_frame(self) -> np.ndarray:
        if self.backend == "sounddevice":
            try:
                raw = self._sd_q.get(timeout=MIC_READ_TIMEOUT_S)
            except queue.Empty:
                raise TimeoutError(
                    f"mic read stalled >{MIC_READ_TIMEOUT_S}s (PortAudio stream stopped delivering)"
                ) from None
            return np.frombuffer(raw, dtype=np.int16)
        return np.frombuffer(self._read_exact(BYTES_PER_FRAME), dtype=np.int16)

    def read_frame(self) -> np.ndarray:
        """One FRAME-sample int16 mono frame; restarts the backend (bounded) on failure.
        Also watches for the all-silence capture signature and hints once, visibly."""
        while True:
            try:
                frame = self._read_backend_frame()
                if self._silence.update(frame):
                    log(SILENCE_HINT_MSG)
                return frame
            except (TimeoutError, EOFError) as e:
                self._restarts += 1
                if self._restarts > MIC_RESTART_LIMIT:
                    raise RuntimeError(f"mic capture failed {self._restarts}x: {e}") from e
                log(f"mic capture error ({e}); restarting {self.backend} (attempt {self._restarts})")
                self.close()
                self._start()

    def close(self) -> None:
        if self._sd_stream is not None:
            try:
                self._sd_stream.stop()
                self._sd_stream.close()
            except Exception:  # noqa: BLE001 — closing a dead stream must not mask the real error
                pass
            self._sd_stream = None
            self._sd_q = None
        if self._proc:
            self._proc.kill()
            self._proc.wait(timeout=5)
            self._proc = None


# ─── side-channel publish (best-effort, mirrors mcp_server.py's _publish) ────

def publish(kind: str, **fields) -> None:
    sidechannel.publish({"kind": kind, **fields})


# ─── echo suppression: mute wake scoring while our own reply is playing ──────
# NJ-57 (echo half). The daemon's original note claimed scoring "is paused while a
# reply plays" — true ONLY for the local NIGHTJAR_PLAY_TTS=1 paplay path. In the real
# app the RENDERER plays the WAV, and the daemon resumed scoring the moment it
# published `tts ready` — so June could hear herself through the speakers and wake on
# her own voice. The orb already publishes `tts playing`/`tts ended` (source="orb-ui")
# for exactly this; nothing consumed them (the NJ-56 producer-only pattern, inverted).
# Now the daemon subscribes and mutes between them, with PLAYBACK_MUTE_MAX_S as the
# rule-3 wall-clock backstop so a lost `ended` cannot deafen her forever.

class PlaybackMute:
    """Tracks whether our TTS is currently audible. Pure + clock-injectable so the
    whole state machine is testable offline (no hub, no sound card).

    TWO INDEPENDENT SOURCES, deliberately not one shared flag (Bugbot, PR #153):
    the renderer's playback (driven by side-channel `playing`/`ended`) and the
    daemon's own NIGHTJAR_PLAY_TTS=1 paplay. With both enabled they start from the
    same `tts ready` and finish at different times — a single flag let whichever
    ENDED FIRST unmute while the other was still audible, re-opening the exact
    self-wake path this class exists to close. Muted while EITHER is active; the
    wall-clock backstop applies to each track separately.

    on_event() consumes side-channel events; only `state` matters — `source` is NOT
    filtered: the renderer is the authority on real playback, and the daemon never
    publishes playing/ended itself, so any producer reporting audible TTS should
    mute us (a stricter source filter would silently miss a future player)."""

    def __init__(self, max_s: float = PLAYBACK_MUTE_MAX_S,
                 clock: Callable[[], float] = time.monotonic,
                 on_backstop: Optional[Callable[[], None]] = None) -> None:
        self._max_s = max_s
        self._clock = clock
        self._on_backstop = on_backstop
        self._renderer_since: Optional[float] = None
        self._local_since: Optional[float] = None

    def on_event(self, ev: dict) -> None:
        if (ev or {}).get("kind") != "tts":
            return
        state = ev.get("state")
        if state == "playing":
            self._renderer_since = self._clock()
        elif state in ("ended", "error"):
            self._renderer_since = None
        # 'ready' deliberately ignored: synthesis finishing is not playback starting.

    def begin_local_playback(self) -> None:
        """Mute for the daemon's own NIGHTJAR_PLAY_TTS=1 paplay path, which produces
        no side-channel playing/ended pair."""
        self._local_since = self._clock()

    def end_local_playback(self) -> None:
        """Clears ONLY the local track — the renderer may still be mid-clip."""
        self._local_since = None

    def muted(self) -> bool:
        now = self._clock()
        expired = False
        # Backstop per track: a lost `ended` (renderer crash, side-channel drop)
        # must not deafen the daemon permanently.
        if self._renderer_since is not None and now - self._renderer_since >= self._max_s:
            self._renderer_since = None
            expired = True
        if self._local_since is not None and now - self._local_since >= self._max_s:
            self._local_since = None
            expired = True
        if expired and self._on_backstop:
            self._on_backstop()
        return self._renderer_since is not None or self._local_since is not None


# ─── OpenCode turn: persistent session + SSE listener thread ─────────────────

class OpenCodeVoice:
    """A persistent OpenCode session + background SSE reader, so each wake only
    has to POST a prompt and wait on a queue — no reconnect-per-turn cost."""

    def __init__(self, base_url: str, agent: str, model: str):
        self.base_url = base_url.rstrip("/")
        self.agent = agent
        self.model = model
        # Session-leak fix (voice-phase PR 3): created LAZILY at the first wake, not
        # here — a crash-restart storm used to mint a fresh OpenCode session per
        # daemon start, none of them ever used.
        self.session_id: Optional[str] = None
        self._q: "queue.Queue[dict]" = queue.Queue()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._sse_loop, daemon=True)
        self._thread.start()

    def _ensure_session(self) -> str:
        if not self.session_id:
            r = requests.post(f"{self.base_url}/session", json={"title": "Nightjar voice"}, timeout=10)
            r.raise_for_status()
            self.session_id = r.json()["id"]
            log(f"voice session created: {self.session_id}")
        return self.session_id

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
        session_id = self._ensure_session()
        slash = self.model.find("/")
        model_ref = {"providerID": self.model[:slash], "modelID": self.model[slash + 1:]} if slash > 0 else None
        r = requests.post(
            f"{self.base_url}/session/{session_id}/prompt_async",
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
            elif et in ("permission.asked", "permission.v2.asked"):
                # A voice turn has no approval UI (the desktop PermissionPanel only
                # handles the chat session, not this daemon's session), so a gated
                # tool (e.g. send_email) would otherwise BLOCK the turn until the
                # timeout. Auto-REJECT — never auto-approve, which would defeat the
                # safety gate (CLAUDE.md rule 1). The model gets the rejection and
                # can tell the user to approve it in the desktop app.
                req_id = p.get("id") or p.get("requestID")
                if req_id:
                    self._reply_permission(
                        req_id, "reject",
                        "Auto-rejected: this action needs approval in the Nightjar "
                        "desktop UI; a voice session can't approve it.")
                    log(f"auto-rejected permission ask {req_id} "
                        f"(permission={p.get('permission','?')}) in voice session")
            elif et in ("session.idle", "turn.idle"):
                break
            elif et == "session.error":
                log(f"session.error during turn: {p.get('error')}")
                break
        return "".join(
            parts[pid] for pid in part_order
            if message_role.get(part_owner.get(pid, "")) == "assistant"
        )

    def _reply_permission(self, request_id: str, reply: str, message: str = "") -> None:
        """Reply to a permission.asked in this daemon's session (see prompt_and_wait)."""
        try:
            requests.post(
                f"{self.base_url}/permission/{request_id}/reply",
                json={"reply": reply, **({"message": message} if message else {})},
                timeout=10,
            )
        except requests.RequestException as e:
            log(f"permission reply failed: {e}")

    def close(self) -> None:
        self._stop.set()


# ─── one full wake -> reply turn ──────────────────────────────────────────────

def strip_wake_phrase(transcript: str) -> str:
    low = transcript.lower()
    for w in WAKE_PHRASES:
        if low.startswith(w):
            return transcript[len(w):].lstrip(" ,.").strip()
    return transcript


def handle_wake(mic: MicStream, oc: OpenCodeVoice, max_score: float,
                mute: Optional["PlaybackMute"] = None) -> None:
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
        # Local playback emits no side-channel playing/ended pair, so mute around it
        # directly (the renderer path is driven by its own events instead).
        if mute:
            mute.begin_local_playback()
        try:
            subprocess.run(["paplay", path], check=False, timeout=PLAYBACK_MUTE_MAX_S)
        except subprocess.TimeoutExpired:
            log(f"local paplay exceeded {PLAYBACK_MUTE_MAX_S}s; abandoning playback")
        finally:
            if mute:
                mute.end_local_playback()


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
    log(f"OpenCode voice ready at {OPENCODE_URL} (agent={AGENT}, model={MODEL}; "
        f"session created lazily at first wake)")
    oc = OpenCodeVoice(OPENCODE_URL, AGENT, MODEL)

    detector = _wakeword.WakeWordDetector()
    if not detector.is_custom:
        log(f"WARNING: INTERIM stand-in wake model in use ('{detector.model_key}') - say "
            f"'Hey buddy', NOT 'Hey June', until a trained hey_june.onnx is deployed "
            f"(see wakeword_training/README.md). Licensing note: the non-commercial "
            f"openWakeWord models are gone as of voice-phase PR 5 (NJ-58 resolved), but "
            f"this stand-in's training positives are still Piper/Blizzard-derived — a "
            f"paid build must NOT ship it (NJ-59).")

    # Echo suppression (NJ-57): consume the renderer's real playback events.
    mute = PlaybackMute(
        on_backstop=lambda: log(
            f"WARNING: playback-mute backstop fired after {PLAYBACK_MUTE_MAX_S}s without a "
            f"'tts ended' event (renderer crash or side-channel drop?) — resuming wake "
            f"scoring so a lost event can't deafen the daemon"),
    )
    sub = sidechannel.Subscriber(mute.on_event)

    mic = MicStream()
    log("listening (live mic, real openWakeWord inference on every 80ms frame)…")
    try:
        while True:
            frame = mic.read_frame()
            # Keep draining the mic while muted (so the stream never backs up), but
            # do NOT score — this is what stops June waking on her own voice.
            if mute.muted():
                continue
            score = detector.process_frame(frame)
            if score >= detector.threshold:
                handle_wake(mic, oc, score, mute)
                detector.reset()
                time.sleep(WAKE_COOLDOWN_S)
    except KeyboardInterrupt:
        log("stopping (KeyboardInterrupt)")
    finally:
        mic.close()
        sub.close()
        oc.close()


if __name__ == "__main__":
    main()
