#!/usr/bin/env python
"""Nightjar capabilities MCP server.

Exposes Row-Bot-derived capabilities to OpenCode as MCP tools over stdio:
voice (transcribe/speak), vision (analyze_image/capture_screen), memory
(save/search/list), browser (navigate/click/type/snapshot/scroll/back), and
wake_word_listen. Discrete/stateless calls run in-process; the persistent
browser session is a singleton held in this long-lived process, and its state
(plus wake/transcription events) is pushed to the WebSocket side-channel for the
UI — the streaming/stateful signals MCP itself doesn't carry.
"""
from __future__ import annotations

import os
import sys
from typing import Any, Dict, List

# ensure the package is importable when launched by OpenCode from any cwd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server.fastmcp import FastMCP

from nightjar_capabilities import memory as _memory
from nightjar_capabilities import vision as _vision
from nightjar_capabilities import voice as _voice
from nightjar_capabilities import browser as _browser
from nightjar_capabilities import wakeword as _wakeword
import sidechannel

mcp = FastMCP("nightjar-capabilities")


def _publish(kind: str, **fields) -> None:
    sidechannel.publish({"kind": kind, **fields})


def _browser_state_from_snapshot(snap: str) -> Dict[str, str]:
    url = title = ""
    for line in snap.splitlines():
        if line.startswith("URL:"):
            url = line[4:].strip()
        elif line.startswith("Title:"):
            title = line[6:].strip()
    return {"url": url, "title": title}


# ---------------- voice ----------------
@mcp.tool()
def transcribe(audio_path: str) -> str:
    """Transcribe speech from an audio file (wav/mp3/…) to text using local
    faster-whisper. Returns the transcript."""
    text = _voice.transcribe(audio_path)
    _publish("transcription", text=text, final=True)
    return text


@mcp.tool()
def speak(text: str, voice: str = "af_heart") -> str:
    """Synthesize `text` to speech (local kokoro-onnx). Returns the path to the
    generated WAV file. (No live playback on this host — no sound card.)"""
    path = _voice.speak(text, voice=voice)
    _publish("tts", state="ready", path=path, text=text)
    return path


# ---------------- vision ----------------
@mcp.tool()
def analyze_image(image_path: str, question: str = "Describe this image.") -> str:
    """Analyze an image file with the local vision model (Ollama gemma3:4b)."""
    return _vision.analyze_image(image_path, question)


@mcp.tool()
def capture_screen(question: str = "") -> str:
    """Capture the primary monitor and (if `question` given) analyze it.
    Requires a display; returns an error string if unavailable."""
    return _vision.capture_screen(question or None)


# ---------------- memory ----------------
@mcp.tool()
def save_memory(content: str, subject: str = "", kind: str = "note", tags: str = "") -> Dict[str, Any]:
    """Persist a durable memory (fact/preference/note) for later recall."""
    r = _memory.save_memory(content, subject=subject or None, kind=kind, tags=tags)
    return {"id": r.get("id"), "subject": r.get("subject")}


@mcp.tool()
def search_memory(query: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Recall memories relevant to `query` (semantic + keyword + graph)."""
    return _memory.search_memory(query, limit=limit)


@mcp.tool()
def list_memory(limit: int = 20) -> List[Dict[str, Any]]:
    """List stored memories."""
    return _memory.list_memory(limit=limit)


# ---------------- browser (stateful singleton; state pushed to side-channel) ----------------
def _browser_result(snap: str) -> str:
    _publish("browser_state", **_browser_state_from_snapshot(snap))
    return snap


@mcp.tool()
def browser_navigate(url: str) -> str:
    """Open a URL in the persistent headless browser; returns an accessibility
    snapshot listing interactive elements addressed by [ref] numbers."""
    return _browser_result(_browser.navigate(url))


@mcp.tool()
def browser_click(ref: int) -> str:
    """Click the element with the given [ref] from the last snapshot."""
    return _browser_result(_browser.click(ref))


@mcp.tool()
def browser_type(ref: int, text: str, submit: bool = False) -> str:
    """Type `text` into the [ref] element; set submit=true to press Enter."""
    return _browser_result(_browser.type_text(ref, text, submit=submit))


@mcp.tool()
def browser_snapshot() -> str:
    """Re-read the current page's accessibility snapshot."""
    return _browser_result(_browser.snapshot())


@mcp.tool()
def browser_scroll(direction: str = "down", amount: int = 3) -> str:
    """Scroll the page ('up'/'down')."""
    return _browser_result(_browser.scroll(direction=direction, amount=amount))


@mcp.tool()
def browser_back() -> str:
    """Navigate back in history."""
    return _browser_result(_browser.go_back())


# ---------------- wake word ----------------
@mcp.tool()
def wake_word_listen(audio_path: str = "", timeout_s: float = 8.0) -> Dict[str, Any]:
    """Listen for the 'Hey Nightjar' wake word, then transcribe the command that
    follows. Pass `audio_path` to run against a recorded clip (headless/testing);
    with no path a live mic is required (unavailable on this host). Returns
    {detected, command, wake}. Publishes wake + transcription to the side-channel."""
    if not audio_path:
        return {"detected": False, "error": "no audio_path and no live mic on this host",
                "command": ""}
    det = _wakeword.detect_in_wav(audio_path)
    result: Dict[str, Any] = {"detected": det["detected"], "wake": det, "command": ""}
    if det["detected"]:
        _publish("wake", **det)
        transcript = _voice.transcribe(audio_path)
        # strip a leading wake phrase if present
        cmd = transcript
        low = transcript.lower()
        for w in ("hey nightjar", "hey jarvis"):
            if low.startswith(w):
                cmd = transcript[len(w):].lstrip(" ,.").strip()
                break
        result["command"] = cmd
        _publish("transcription", text=cmd, final=True)
    return result


if __name__ == "__main__":
    mcp.run()
