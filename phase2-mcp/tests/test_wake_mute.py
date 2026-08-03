#!/usr/bin/env python
"""Offline tests for voice-phase PR 4: echo suppression (NJ-57, echo half).

Two layers:
  1. PURE — the PlaybackMute state machine on an injected clock: mute on the
     renderer's `tts playing`, unmute on `ended`, and the rule-3 wall-clock
     backstop that stops a LOST `ended` from deafening the daemon forever.
  2. LIVE — the real sidechannel.Subscriber against a REAL hub on :8765,
     driven by real published frames (skipped with a clear message if the hub
     isn't running; start it with `python phase2-mcp/sidechannel.py`).

No sound card, no models, no OpenCode needed.

Run with the phase2-mcp venv:
  phase2-mcp/venv/Scripts/python phase2-mcp/tests/test_wake_mute.py
"""
import sys
import time
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sidechannel  # noqa: E402
import wake_daemon as wd  # noqa: E402

FAILS = []


def check(name, cond, got=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name}{'' if cond else f'  (got {got!r})'}")
    if not cond:
        FAILS.append(name)


print("== 1. PlaybackMute — driven by the renderer's real event shapes ==")
clock = {"t": 100.0}
fired = []
m = wd.PlaybackMute(max_s=90.0, clock=lambda: clock["t"], on_backstop=lambda: fired.append(clock["t"]))

check("idle at start", not m.muted())
m.on_event({"kind": "tts", "state": "ready", "path": "/x.wav"})
check("'ready' does NOT mute (synthesis != playback)", not m.muted())

# The exact frame orbAdapter.ts publishes when playback actually begins.
m.on_event({"kind": "tts", "state": "playing", "source": "orb-ui"})
check("'playing' mutes wake scoring", m.muted())
clock["t"] += 5.0
check("stays muted mid-clip", m.muted())
m.on_event({"kind": "tts", "state": "ended", "source": "orb-ui"})
check("'ended' unmutes", not m.muted())

print("\n== 2. unrelated events don't disturb the mute ==")
m.on_event({"kind": "tts", "state": "playing", "source": "orb-ui"})
m.on_event({"kind": "wake", "detected": True})
m.on_event({"kind": "transcription", "text": "hi", "final": True})
m.on_event({"kind": "browser_state", "url": "https://x"})
check("still muted after unrelated events", m.muted())
m.on_event({"kind": "tts", "state": "error"})
check("'error' unmutes (a failed clip is not audible)", not m.muted())

print("\n== 3. wall-clock backstop (rule 3) — a LOST 'ended' cannot deafen the daemon ==")
clock["t"] = 1000.0
m2 = wd.PlaybackMute(max_s=90.0, clock=lambda: clock["t"], on_backstop=lambda: fired.append(clock["t"]))
m2.on_event({"kind": "tts", "state": "playing"})
clock["t"] += 89.0
check("still muted just before the cap", m2.muted())
clock["t"] += 2.0  # 91s — past the cap, and no 'ended' ever arrived
check("backstop unmutes past the cap", not m2.muted())
check("backstop reported once", len(fired) == 1, fired)
check("and stays unmuted afterwards", not m2.muted())
check("backstop cap is longer than the orb's 60s speaking watchdog",
      wd.PLAYBACK_MUTE_MAX_S > 60.0, wd.PLAYBACK_MUTE_MAX_S)

print("\n== 4. local paplay path mutes explicitly (no side-channel pair) ==")
m3 = wd.PlaybackMute(max_s=90.0, clock=lambda: clock["t"])
m3.begin_local_playback()
check("local playback mutes", m3.muted())
m3.end_local_playback()
check("local playback end unmutes", not m3.muted())

print("\n== 5. LIVE — the real Subscriber against the real hub on :8765 ==")
if not sidechannel.publish({"kind": "noop", "source": "wake-mute-test"}):
    print("[SKIP] side-channel hub not running on :8765 — "
          "start it with `python phase2-mcp/sidechannel.py` to exercise this layer")
else:
    live = wd.PlaybackMute(max_s=90.0)  # real monotonic clock
    sub = sidechannel.Subscriber(live.on_event)
    try:
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline and not getattr(sub, "_thread").is_alive():
            time.sleep(0.05)
        time.sleep(0.7)  # let the subscription establish

        sidechannel.publish({"kind": "tts", "state": "playing", "source": "orb-ui"})
        got_mute = False
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if live.muted():
                got_mute = True
                break
            time.sleep(0.05)
        check("real 'playing' frame over the hub mutes the daemon", got_mute)

        sidechannel.publish({"kind": "tts", "state": "ended", "source": "orb-ui"})
        got_unmute = False
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if not live.muted():
                got_unmute = True
                break
            time.sleep(0.05)
        check("real 'ended' frame over the hub unmutes", got_unmute)
    finally:
        sub.close()

print("\n" + ("FAILED: " + "; ".join(FAILS) if FAILS else "ALL CHECKS PASSED"))
sys.exit(1 if FAILS else 0)
