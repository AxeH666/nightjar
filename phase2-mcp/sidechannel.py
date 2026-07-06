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


if __name__ == "__main__":
    asyncio.run(main())
