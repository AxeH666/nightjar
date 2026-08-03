#!/usr/bin/env python
"""Offline tests for voice-phase PR 3: cross-platform mic capture plumbing.

No sound card, no network: exercises the PURE pieces — backend selection, the
all-silence (Windows mic-privacy-off) detector, wake-phrase stripping incl.
"hey june", frame math, and the wake-phrase sync between wake_daemon and
mcp_server (text-level, so importing the heavy MCP server isn't needed).

Run with the phase2-mcp venv:
  phase2-mcp/venv/Scripts/python phase2-mcp/tests/test_wake_capture.py
"""
import os
import re
import sys
from pathlib import Path

import numpy as np

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import wake_daemon as wd  # noqa: E402 — module import is light (models load lazily)

FAILS = []


def check(name, cond, got=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}{'' if cond else f'  (got {got!r})'}")
    if not cond:
        FAILS.append(name)


print("== 1. backend selection (pure) ==")
sel = wd.select_mic_backend
check("sounddevice preferred when available", sel(None, True, True) == "sounddevice")
check("sounddevice even without parec", sel(None, True, False) == "sounddevice")
check("parec fallback when sounddevice unavailable", sel(None, False, True) == "parec")
check("force=parec wins over available sounddevice", sel("parec", True, True) == "parec")
check("force=sounddevice honored even if probe failed (open-time surfaces it)",
      sel("sounddevice", False, True) == "sounddevice")
try:
    sel(None, False, False, "ImportError: no PortAudio")
    check("no backend at all raises", False)
except RuntimeError as e:
    msg = str(e)
    check("no backend at all raises", True)
    check("error names BOTH failures", "PortAudio" in msg and "parec" in msg, msg)
try:
    sel("bogus", True, True)
    check("unknown forced backend raises", False)
except RuntimeError:
    check("unknown forced backend raises", True)

print("\n== 2. digital-silence detection (the Windows mic-privacy-off signature) ==")
zeros = np.zeros(wd.FRAME, dtype=np.int16)
one_lsb = zeros.copy()
one_lsb[7] = 1
check("all-zero frame is digital silence", wd.is_digital_silence(zeros))
check("a single LSB of noise floor is NOT silence", not wd.is_digital_silence(one_lsb))
check("empty frame counts as silence (defensive)", wd.is_digital_silence(np.zeros(0, dtype=np.int16)))

print("\n== 3. SilenceTracker — hint fires once per continuous silent run ==")
clock = {"t": 0.0}
tr = wd.SilenceTracker(hint_after_s=10.0, clock=lambda: clock["t"])
fired = []
for _ in range(3):
    fired.append(tr.update(zeros))
    clock["t"] += 4.0  # 0s, 4s, 8s of silence — under threshold
check("no hint before the threshold", not any(fired))
clock["t"] = 12.0
check("hint fires once threshold crossed", tr.update(zeros))
clock["t"] = 20.0
check("hint does NOT repeat within the same silent run", not tr.update(zeros))
check("real audio resets the run", not tr.update(one_lsb))
clock["t"] = 25.0
tr.update(zeros)  # new silent run starts
clock["t"] = 40.0
check("a NEW silent run re-hints", tr.update(zeros))

print("\n== 4. wake-phrase stripping — 'hey june' is the product phrase ==")
strip = wd.strip_wake_phrase
check("'hey june' listed first", wd.WAKE_PHRASES[0] == "hey june", wd.WAKE_PHRASES)
check("Hey June stripped", strip("Hey June, what's the time") == "what's the time")
check("hey june lowercase stripped", strip("hey june turn on the lab") == "turn on the lab")
check("legacy hey nightjar still stripped", strip("Hey Nightjar do a thing") == "do a thing")
# PR 5: the interim stand-in model answers to "hey buddy"; "hey jarvis" left with
# openWakeWord — nothing responds to it, so stripping it would hide a mis-detect.
check("interim hey buddy stripped", strip("Hey buddy, status") == "status")
check("hey jarvis NO LONGER stripped", strip("hey jarvis. status") == "hey jarvis. status")
check("no phrase → transcript unchanged", strip("what's the weather") == "what's the weather")
check("phrase mid-sentence NOT stripped", strip("I said hey june earlier") == "I said hey june earlier")

print("\n== 5. frame math (sounddevice blocksize == the wake pipeline's hop) ==")
# PR 5: hey-buddy hops 120ms (1920 samples), not openWakeWord's 80ms/1280.
check("FRAME is 120ms @ 16k", wd.FRAME == 1920 and wd.SR == 16000)
check("BYTES_PER_FRAME is int16 mono", wd.BYTES_PER_FRAME == 3840)
raw = (np.arange(wd.FRAME) % 251).astype(np.int16).tobytes()
frame = np.frombuffer(raw, dtype=np.int16)
check("bytes→frame roundtrip preserves length", frame.size == wd.FRAME)

print("\n== 6. wake-phrase lists stay in sync (text-level; mcp_server is heavy to import) ==")
mcp_src = (Path(__file__).resolve().parents[1] / "mcp_server.py").read_text(encoding="utf-8")
m = re.search(r'for w in \(([^)]*)\)', mcp_src)
mcp_phrases = tuple(s.strip().strip("\"'") for s in m.group(1).split(",") if s.strip()) if m else ()
check("mcp_server strips the same phrases", mcp_phrases == wd.WAKE_PHRASES, mcp_phrases)

print("\n" + ("FAILED: " + "; ".join(FAILS) if FAILS else "ALL CHECKS PASSED"))
sys.exit(1 if FAILS else 0)
