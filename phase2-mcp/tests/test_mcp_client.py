"""Integration test: drive the Nightjar MCP server over stdio like OpenCode
would, and verify (a) tool calls work and (b) events land on the side-channel.

Run: ./venv/bin/python tests/test_mcp_client.py
Requires: side-channel hub already running (python sidechannel.py).
"""
import asyncio
import json
import os
import sys

import websockets
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIP = os.environ.get("NIGHTJAR_TEST_CLIP", "/tmp/nj-voice-test/hey_jarvis.wav")
PAGE = "file:///tmp/nj-browser-test.html"

collected_events = []


async def subscriber(stop: asyncio.Event):
    try:
        async with websockets.connect("ws://127.0.0.1:8765", open_timeout=3) as ws:
            while not stop.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                msg = json.loads(raw)
                if msg.get("type") == "event":
                    collected_events.append(msg["event"])
    except Exception as e:
        print("subscriber error:", e)


async def main():
    stop = asyncio.Event()
    sub = asyncio.create_task(subscriber(stop))
    await asyncio.sleep(0.5)  # let subscriber connect

    env = dict(os.environ)
    env["NIGHTJAR_DATA_DIR"] = "/tmp/nj-mcp-test"
    env["NIGHTJAR_WHISPER_SIZE"] = "base.en"
    params = StdioServerParameters(command=f"{HERE}/venv/bin/python",
                                   args=[f"{HERE}/mcp_server.py"], env=env)
    results = {}
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as session:
            await session.initialize()
            tools = await session.list_tools()
            results["tool_count"] = len(tools.tools)

            # memory save + recall
            await session.call_tool("save_memory", {
                "content": "The user's favorite programming language is Rust.",
                "kind": "preference", "tags": "lang"})
            sm = await session.call_tool("search_memory", {"query": "what language does the user like", "limit": 3})
            results["memory_recall"] = sm.content[0].text if sm.content else ""

            # browser navigate (stateful) — should publish browser_state
            bn = await session.call_tool("browser_navigate", {"url": PAGE})
            results["browser"] = (bn.content[0].text if bn.content else "")[:120]

            # wake + transcribe from clip — should publish wake + transcription
            ww = await session.call_tool("wake_word_listen", {"audio_path": CLIP})
            results["wake"] = ww.content[0].text if ww.content else ""

    await asyncio.sleep(0.5)
    stop.set()
    await sub
    results["events"] = [e.get("kind") for e in collected_events]
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
