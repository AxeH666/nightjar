"""Nightjar vision capability — a wrapper over the vendored Row-Bot VisionService.

Backend follows the user's EXPLICIT vision choice (Offline default): the local Ollama
model (default gemma3:4b), or an Online cloud provider selected via the vision capability
pref (NIGHTJAR_VISION_PROVIDER). The Online path is implemented HERE against an
OpenAI-compatible /chat/completions endpoint (the vendored row_bot cloud branch is a
disabled stub); a stored BYOK key alone never routes cloud.

analyze_image works on a file path or raw bytes (no camera needed).
capture_screen uses mss and requires a display (best-effort; may be unavailable
headless — the caller gets a clear error string, not a crash).
"""
from __future__ import annotations

import os
from typing import Optional, Union

import nightjar_capabilities  # noqa: F401 (bootstraps _vendor shim)
import row_bot.vision as _vision
from nightjar_capabilities.vision_backend import resolve_vision_backend

_svc = None

# The local vision model — SAME source the phase3-ui readiness banner probes
# (NIGHTJAR_VISION_MODEL). _service() aligns VisionService to it so vision_settings.json
# can't silently drift from what the banner reports (audit source-of-truth fix).
VISION_MODEL = os.environ.get("NIGHTJAR_VISION_MODEL", "gemma3:4b")

# NJ-7: shown when local image analysis can't run because Ollama / the vision model
# isn't set up. Actionable + points at the in-app setup path and the cloud escape.
_VISION_HELP = (
    "Local image analysis needs Ollama running with the gemma3:4b vision model. "
    "Install it from Nightjar's vision banner (or run `ollama pull gemma3:4b`), or set "
    "Vision to Online (a cloud provider) in the Capabilities settings to analyze now."
)


def _service():
    global _svc
    if _svc is None:
        _svc = _vision.VisionService()
        # Source-of-truth unification: run local analysis on the SAME model the readiness
        # banner shows (NIGHTJAR_VISION_MODEL), so vision_settings.json follows the env
        # instead of drifting from it. (Cloud vision no longer routes through
        # vision_settings — it's the explicit NIGHTJAR_VISION_PROVIDER path below.)
        try:
            if _svc.model != VISION_MODEL:
                _svc.model = VISION_MODEL  # setter persists → settings file follows the env
        except Exception:
            pass
    return _svc


def _guess_mime(data: bytes) -> str:
    """Best-effort image MIME from magic bytes (default png)."""
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def _analyze_cloud(data: bytes, question: str, provider: str, base_url: str, model: str, key: str) -> str:
    """Analyze `data` with an explicit Online provider via OpenAI-compatible vision. A
    hard wall-clock timeout bounds the round-trip (rule 3). Errors are RETURNED as a
    clear string (not raised, and NOT silently downgraded to local — the user chose
    cloud), so the caller/model sees what happened."""
    import base64
    import json
    import urllib.error
    import urllib.request

    b64 = base64.b64encode(data).decode("ascii")
    data_url = f"data:{_guess_mime(data)};base64,{b64}"
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": question or "Describe this image."},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
        "max_tokens": int(os.environ.get("NIGHTJAR_VISION_MAX_TOKENS", "512")),
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if provider == "openrouter":  # Nightjar attribution (never Odysseus branding)
        headers["HTTP-Referer"] = "https://github.com/AxeH666/nightjar"
        headers["X-Title"] = "Nightjar"
    timeout = float(os.environ.get("NIGHTJAR_VISION_TIMEOUT_S", "60"))
    url = base_url.rstrip("/") + "/chat/completions"
    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = json.load(r)
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:300]
        except Exception:
            pass
        return f"Error: cloud vision ({provider}) HTTP {e.code}: {detail or e.reason}"
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return f"Error: cloud vision ({provider}) failed/timed out after {timeout:.0f}s: {e}"
    except Exception as e:
        return f"Error: cloud vision ({provider}) failed: {e}"
    try:
        content = body["choices"][0]["message"]["content"]
        if isinstance(content, list):  # some providers return content parts
            content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
        return content or "(cloud vision returned no description)"
    except (KeyError, IndexError, TypeError):
        return f"Error: cloud vision ({provider}) returned an unexpected response."


def _analyze_data(data: bytes, question: str) -> str:
    """Route `data` to the user's chosen vision backend: an explicit Online provider, or
    the local Ollama model (default)."""
    backend, base_url, model, key = resolve_vision_backend()
    if backend != "local":
        return _analyze_cloud(data, question, backend, base_url or "", model or "", key or "")
    blocker = _local_vision_blocker()
    if blocker:
        return blocker
    return _service().analyze(data, question)


def _local_vision_blocker() -> Optional[str]:
    """Return an actionable message if local vision is DEFINITIVELY not ready (Ollama
    unreachable, or the model not pulled); return None if it looks ready OR the check
    is inconclusive (fail-open — an unexpected probe error must not block a path that
    might work, so analyze() still gets to try and surface its own error)."""
    import json
    import os
    import urllib.error
    import urllib.request

    # Probe the EXACT model analyze() will use. _service() now aligns VisionService to
    # NIGHTJAR_VISION_MODEL (the same value the phase3-ui banner probes), so the readiness
    # check and the analysis path agree. Only runs for the LOCAL path — the explicit
    # Online cloud path never reaches here (handled in _analyze_data).
    try:
        model = _service().model
    except Exception:
        return None  # can't resolve the model → inconclusive, let analyze() try
    # Defensive: a provider-prefixed ("openai/…") model isn't an Ollama tag — don't gate
    # it on local readiness (normally unreachable now that cloud routes elsewhere).
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
    """Analyze an image (file path or raw bytes) with the chosen vision backend
    (local Ollama by default, or an explicit Online cloud provider)."""
    data = open(image, "rb").read() if isinstance(image, str) else image
    return _analyze_data(data, question)


def capture_screen(question: Optional[str] = None) -> str:
    """Capture the primary monitor; if `question` is given, analyze it (via the chosen
    vision backend), else return a status. Requires a display server (mss); returns an
    error string if unavailable rather than raising."""
    try:
        img = _service().screenshot()
    except Exception as e:  # mss import / display failure
        return f"Screen capture unavailable: {e}"
    if not img:
        return "Screen capture returned no image (no display?)."
    if question:
        return _analyze_data(img, question)
    return f"Captured screen ({len(img)} bytes)."
