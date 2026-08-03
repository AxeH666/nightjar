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

print("\n== 4b. the two playback tracks are INDEPENDENT (Bugbot, PR #153) ==")
# NIGHTJAR_PLAY_TTS=1 with the app also running: both players start from the same
# `tts ready` and finish at different times. Whichever ends FIRST must not unmute
# while the other is still audible — that re-opens the self-wake path.
clock["t"] = 2000.0
m4 = wd.PlaybackMute(max_s=90.0, clock=lambda: clock["t"])
m4.on_event({"kind": "tts", "state": "playing", "source": "orb-ui"})
m4.begin_local_playback()
check("both playing → muted", m4.muted())
clock["t"] += 2.0
m4.end_local_playback()  # paplay finished first; the orb clip is longer
check("local end does NOT unmute while the renderer is still playing", m4.muted())
m4.on_event({"kind": "tts", "state": "ended", "source": "orb-ui"})
check("renderer 'ended' then unmutes", not m4.muted())

# ...and the mirror case: the renderer's clip ends first, local paplay still going.
m5 = wd.PlaybackMute(max_s=90.0, clock=lambda: clock["t"])
m5.on_event({"kind": "tts", "state": "playing"})
m5.begin_local_playback()
m5.on_event({"kind": "tts", "state": "ended"})
check("renderer end does NOT unmute while local paplay is still running", m5.muted())
m5.end_local_playback()
check("local end then unmutes", not m5.muted())

# Each track keeps its OWN backstop.
clock["t"] = 3000.0
m6 = wd.PlaybackMute(max_s=90.0, clock=lambda: clock["t"])
m6.on_event({"kind": "tts", "state": "playing"})
clock["t"] += 30.0
m6.begin_local_playback()          # starts 30s later → expires 30s later
clock["t"] += 61.0                 # renderer track is 91s old, local only 61s
check("expired renderer track alone does not unmute a live local track", m6.muted())
clock["t"] += 30.0                 # local now 91s old too
check("both tracks expired → unmuted", not m6.muted())

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

    print("\n== 6. LIVE — a STALE hub snapshot must not mute a fresh daemon (Bugbot, PR #153) ==")
    # The hub keeps LATEST-per-kind. Leave `tts playing` as the last tts event with
    # no `ended` (exactly what a renderer crash mid-clip leaves behind), then connect
    # a NEW subscriber: replaying that timestamp-less history as if live would mute a
    # freshly-started daemon for the whole backstop window with nothing playing.
    sidechannel.publish({"kind": "tts", "state": "playing", "source": "orb-ui"})
    time.sleep(0.3)
    fresh = wd.PlaybackMute(max_s=90.0)
    sub2 = sidechannel.Subscriber(fresh.on_event)  # default: replay_snapshot=False
    try:
        time.sleep(1.0)  # connect + snapshot delivery window
        check("fresh daemon is NOT muted by the stale snapshot", not fresh.muted())
        # ...but it still follows LIVE frames from that point on.
        sidechannel.publish({"kind": "tts", "state": "playing", "source": "orb-ui"})
        got = False
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if fresh.muted():
                got = True
                break
            time.sleep(0.05)
        check("and still mutes on a LIVE frame after ignoring the snapshot", got)
    finally:
        sub2.close()
        sidechannel.publish({"kind": "tts", "state": "ended", "source": "orb-ui"})  # leave the hub clean

    print("\n== 6b. opt-in snapshot replay still works for consumers that want it ==")
    sidechannel.publish({"kind": "browser_state", "url": "https://example.test"})
    time.sleep(0.3)
    seen = []
    sub3 = sidechannel.Subscriber(seen.append, replay_snapshot=True)
    try:
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and not any(e.get("kind") == "browser_state" for e in seen):
            time.sleep(0.05)
        check("replay_snapshot=True delivers the connect-time snapshot",
              any(e.get("kind") == "browser_state" for e in seen))
    finally:
        sub3.close()

print("\n" + ("FAILED: " + "; ".join(FAILS) if FAILS else "ALL CHECKS PASSED"))
sys.exit(1 if FAILS else 0)
