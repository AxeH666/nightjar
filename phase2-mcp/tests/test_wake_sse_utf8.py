#!/usr/bin/env python3
"""NJ-92 regression: the OpenCode SSE reply path always decodes as UTF-8."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

SESSION_ID = "session-nj92"
MESSAGE_ID = "message-nj92"
PART_ID = "part-nj92"
REPLY = "I\u2019m ready \u2014 42."

FAILS: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f": {detail}" if detail else ""))
    if not ok:
        FAILS.append(label)


def sse_data(event: dict) -> bytes:
    return ("data: " + json.dumps(event, ensure_ascii=False) + "\n\n").encode("utf-8")


prompt_received = threading.Event()
release_stream = threading.Event()
stream_sent = threading.Event()
received_prompt: dict = {}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _format: str, *_args) -> None:
        pass

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length)) if length else {}

    def _send_json(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _write_chunk(self, payload: bytes) -> None:
        self.wfile.write(f"{len(payload):X}\r\n".encode("ascii"))
        self.wfile.write(payload)
        self.wfile.write(b"\r\n")
        self.wfile.flush()

    def do_POST(self) -> None:
        if self.path == "/session":
            self._read_json()
            self._send_json(200, {"id": SESSION_ID})
            return
        if self.path == f"/session/{SESSION_ID}/prompt_async":
            received_prompt.update(self._read_json())
            prompt_received.set()
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_error(404)

    def do_GET(self) -> None:
        if self.path != "/event":
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        if not prompt_received.wait(timeout=5):
            return
        if stream_sent.is_set():
            release_stream.wait(timeout=5)
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
            return
        stream_sent.set()
        stream = b"".join(
            [
                sse_data(
                    {
                        "type": "message.updated",
                        "properties": {
                            "info": {
                                "id": MESSAGE_ID,
                                "role": "assistant",
                                "sessionID": SESSION_ID,
                            }
                        },
                    }
                ),
                sse_data(
                    {
                        "type": "message.part.updated",
                        "properties": {
                            "part": {
                                "id": PART_ID,
                                "messageID": MESSAGE_ID,
                                "sessionID": SESSION_ID,
                                "type": "text",
                                "text": REPLY,
                            }
                        },
                    }
                ),
                sse_data(
                    {
                        "type": "session.idle",
                        "properties": {"sessionID": SESSION_ID},
                    }
                ),
            ]
        )
        split_at = stream.index("\u2014".encode("utf-8")) + 1
        try:
            self._write_chunk(stream[:split_at])
            self._write_chunk(stream[split_at:])
            self.wfile.write(b"0\r\n\r\n")
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


with tempfile.TemporaryDirectory(prefix="june-nj92-sse-") as data_dir:
    os.environ["NIGHTJAR_DATA_DIR"] = data_dir

    import wake_daemon

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    client = wake_daemon.OpenCodeVoice(
        f"http://127.0.0.1:{server.server_port}",
        "assistant",
        "test/model",
    )
    try:
        reply = client.prompt_and_wait("Return the NJ-92 fixture.", timeout_s=5)
    finally:
        client.close()
        release_stream.set()
        client._thread.join(timeout=5)
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)

print("== NJ-92 charset-less SSE reply ==")
check("production prompt path was exercised", bool(received_prompt))
check("reply is exact UTF-8 text", reply == REPLY, f"got {ascii(reply)}")
check("curly apostrophe survives", "\u2019" in reply)
check("em dash survives", "\u2014" in reply)
check("number survives", "42" in reply)
check("no mojibake lead byte survives", "\u00e2" not in reply)
check(
    "no C1 mojibake codepoint survives",
    not any(0x80 <= ord(char) <= 0x9F for char in reply),
)

print("\n" + ("FAILED: " + "; ".join(FAILS) if FAILS else "ALL CHECKS PASSED"))
sys.exit(1 if FAILS else 0)
