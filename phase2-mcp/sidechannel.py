#!/usr/bin/env python
"""Nightjar side-channel — a WebSocket hub for the streaming/stateful signals
that MCP's request/response model doesn't carry well:
  - wake-word state ("wake" events)
  - live / final transcription
  - persistent browser session state (url/title/tabs after each action)
  - TTS playback state

UI clients connect and receive broadcast `event` frames (plus a `snapshot` of
the latest state per kind on connect). Producers (the MCP server, a mic/wake
loop) connect and send `{"type":"publish","event":{...}}`, which the hub
rebroadcasts. One dependency (websockets); everything is JSON.

Run:  python sidechannel.py   (listens on ws://127.0.0.1:8765 by default)
"""
from __future__ import annotations

import asyncio
import json
import os

import websockets

HOST = os.environ.get("NIGHTJAR_WS_HOST", "127.0.0.1")
PORT = int(os.environ.get("NIGHTJAR_WS_PORT", "8765"))

SUBSCRIBERS: set = set()
LATEST: dict = {}  # kind -> last event


async def _broadcast(event: dict) -> None:
    msg = json.dumps({"type": "event", "event": event})
    dead = []
    for ws in list(SUBSCRIBERS):
        try:
            await ws.send(msg)
        except Exception:
            dead.append(ws)
    for d in dead:
        SUBSCRIBERS.discard(d)


async def handler(ws) -> None:
    SUBSCRIBERS.add(ws)
    try:
        await ws.send(json.dumps({"type": "snapshot", "state": LATEST}))
        async for raw in ws:
            try:
                data = json.loads(raw)
            except Exception:
                continue
            if data.get("type") == "publish":
                ev = data.get("event", {})
                LATEST[ev.get("kind", "event")] = ev
                await _broadcast(ev)
    except websockets.ConnectionClosed:
        pass
    finally:
        SUBSCRIBERS.discard(ws)


async def main() -> None:
    print(f"[nightjar-sidechannel] ws://{HOST}:{PORT}", flush=True)
    async with websockets.serve(handler, HOST, PORT):
        await asyncio.Future()


# --- sync publish helper for producers (e.g. the MCP server) ---
def publish(event: dict) -> bool:
    """Best-effort synchronous publish of one event. Never raises (side-channel
    is optional telemetry — a discrete MCP call must still succeed if it's down)."""
    try:
        from websockets.sync.client import connect
        with connect(f"ws://{HOST}:{PORT}", open_timeout=1) as ws:
            ws.send(json.dumps({"type": "publish", "event": event}))
        return True
    except Exception:
        return False


# --- background subscriber for long-lived consumers (the wake daemon) ---
class Subscriber:
    """Persistent background subscription to the hub: `on_event(dict)` is called
    for every broadcast event (and for each entry of the connect-time snapshot),
    on the reader thread.

    Added for the wake daemon's echo suppression (voice-phase PR 4): the renderer
    publishes `tts playing/ended` — a PRODUCER-ONLY event until now — and the
    daemon must consume it to stop hearing June's own voice. Best-effort and
    self-reconnecting: the side-channel being down degrades a feature, it must
    never kill its consumer. `on_event` exceptions are swallowed for the same
    reason (a bad handler must not stop the stream).

    `replay_snapshot` defaults to **False** — the hub's connect-time snapshot is
    LATEST-per-kind HISTORY with no timestamp, so replaying it as if live is a
    staleness trap (Bugbot, PR #153): a `tts playing` whose `ended` never reached
    the hub (renderer crash) would mute every newly-connected daemon for the whole
    backstop window despite nothing actually playing. Consumers that genuinely
    want current-state-on-connect (a UI restoring browser_state, say) opt in
    explicitly and must handle the events being arbitrarily old."""

    def __init__(self, on_event, url: str | None = None, reconnect_s: float = 2.0,
                 replay_snapshot: bool = False) -> None:
        import threading

        self._on_event = on_event
        self._url = url or f"ws://{HOST}:{PORT}"
        self._reconnect_s = reconnect_s
        self._replay_snapshot = replay_snapshot
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True, name="sidechannel-sub")
        self._thread.start()

    def _dispatch(self, ev: dict) -> None:
        try:
            self._on_event(ev)
        except Exception:
            pass

    def _loop(self) -> None:
        from websockets.sync.client import connect

        while not self._stop.is_set():
            try:
                with connect(self._url, open_timeout=2) as ws:
                    while not self._stop.is_set():
                        # Bounded recv so a silent hub can't wedge the stop check.
                        try:
                            raw = ws.recv(timeout=1)
                        except TimeoutError:
                            continue
                        try:
                            data = json.loads(raw)
                        except Exception:
                            continue
                        if data.get("type") == "event":
                            self._dispatch(data.get("event") or {})
                        elif data.get("type") == "snapshot" and self._replay_snapshot:
                            for ev in (data.get("state") or {}).values():
                                if isinstance(ev, dict):
                                    self._dispatch(ev)
            except Exception:
                if self._stop.wait(self._reconnect_s):
                    return

    def close(self) -> None:
        self._stop.set()


if __name__ == "__main__":
    asyncio.run(main())
