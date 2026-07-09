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

# NJ-7: shown when local image analysis can't run because Ollama / the vision model
# isn't set up. Actionable + points at the in-app setup path and the cloud escape.
_VISION_HELP = (
    "Local image analysis needs Ollama running with the gemma3:4b vision model. "
    "Install it from Nightjar's vision banner (or run `ollama pull gemma3:4b`), or "
    "pick a cloud vision model (BYOK) to analyze images now."
)


def _service():
    global _svc
    if _svc is None:
        _svc = _vision.VisionService()
    return _svc


def _local_vision_blocker() -> Optional[str]:
    """Return an actionable message if local vision is DEFINITIVELY not ready (Ollama
    unreachable, or the model not pulled); return None if it looks ready OR the check
    is inconclusive (fail-open — an unexpected probe error must not block a path that
    might work, so analyze() still gets to try and surface its own error)."""
    import json
    import os
    import urllib.error
    import urllib.request

    # Probe the EXACT model analyze() will use — VisionService reads its model from
    # vision_settings.json (else the gemma3:4b default) and does NOT read
    # NIGHTJAR_VISION_MODEL, so keying the probe off that env could block a call the
    # analysis path would have completed. Reading _service().model keeps them aligned.
    try:
        model = _service().model
    except Exception:
        return None  # can't resolve the model → inconclusive, let analyze() try
    # A cloud/BYOK vision model (provider-prefixed, e.g. "openai/…") doesn't use
    # Ollama — never gate it on local readiness.
    if not model or "/" in model:
        return None
    host = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
    try:
        with urllib.request.urlopen(f"{host}/api/tags", timeout=2) as r:
            names = [m.get("name", "") for m in json.load(r).get("models", [])]
    except (urllib.error.URLError, OSError, TimeoutError):
        return _VISION_HELP  # Ollama not reachable → definitively not ready
    except Exception:
        return None  # unexpected probe error → inconclusive, let analyze() try
    base = model.split(":")[0]
    if not any(n == model or n.split(":")[0] == base for n in names):
        return _VISION_HELP  # model not pulled
    return None


def analyze_image(image: Union[str, bytes], question: str = "Describe this image.") -> str:
    """Analyze an image (file path or raw bytes) with the local vision model."""
    blocker = _local_vision_blocker()
    if blocker:
        return blocker
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
