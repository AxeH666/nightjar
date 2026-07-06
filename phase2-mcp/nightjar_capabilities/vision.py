"""Nightjar vision capability — clean wrapper over the vendored Row-Bot
VisionService, hard-routed to a LOCAL Ollama vision model (default gemma3:4b).
Cloud/LangChain analysis path is not used.

analyze_image works on a file path or raw bytes (no camera needed).
capture_screen uses mss and requires a display (best-effort; may be unavailable
headless — the caller gets a clear error string, not a crash).
"""
from __future__ import annotations

from typing import Optional, Union

import nightjar_capabilities  # noqa: F401 (bootstraps _vendor shim)
import row_bot.vision as _vision

_svc = None


def _service():
    global _svc
    if _svc is None:
        _svc = _vision.VisionService()
    return _svc


def analyze_image(image: Union[str, bytes], question: str = "Describe this image.") -> str:
    """Analyze an image (file path or raw bytes) with the local vision model."""
    if isinstance(image, str):
        data = open(image, "rb").read()
    else:
        data = image
    return _service().analyze(data, question)


def capture_screen(question: Optional[str] = None) -> str:
    """Capture the primary monitor; if `question` is given, analyze it, else
    return a status. Requires a display server (mss); returns an error string
    if unavailable rather than raising."""
    try:
        img = _service().screenshot()
    except Exception as e:  # mss import / display failure
        return f"Screen capture unavailable: {e}"
    if not img:
        return "Screen capture returned no image (no display?)."
    if question:
        return _service().analyze(img, question)
    return f"Captured screen ({len(img)} bytes)."
