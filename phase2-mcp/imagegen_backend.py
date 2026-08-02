"""Pure image-generation backend selection + payload/response logic for Nightjar.

Odysseus removal, PR E. Replaces the Odysseus image tier (image_gen_server.py +
seed_image_endpoint.py + the Electron seed/reconcile machinery) with the same
explicit-selection pattern research and web search already use:

  * The DEFAULT is "no backend": image generation requires an EXPLICIT Online
    image provider (NIGHTJAR_IMAGE_PROVIDER, set by the Capabilities UI) plus
    that provider's BYOK key. A stored key alone NEVER routes image traffic to
    the cloud — the same silent-cloud-leak rule as research_backend.
  * Offline mode currently means image generation is unavailable and says so
    honestly (there is no local diffusion path since PR G; a local diffusers
    backend can return later as an ADDITIVE provider behind this same seam).

Kept dependency-free (no httpx at module scope, no MCP) so every branch is
unit-testable offline: the HTTP call is injected.
"""
from __future__ import annotations

import base64
import binascii
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

# provider id -> (base_url, default model, BYOK env var, extra headers).
# OpenAI-compatible /images/generations providers only. Mirrors
# research_backend.RESEARCH_PROVIDERS' shape and rules.
IMAGE_PROVIDERS: Dict[str, Tuple[str, str, str, Dict[str, str]]] = {
    "openai": ("https://api.openai.com/v1", "dall-e-3", "NIGHTJAR_BYOK_OPENAI", {}),
    "openrouter": (
        "https://openrouter.ai/api/v1",
        "openai/gpt-image-1",
        "NIGHTJAR_BYOK_OPENROUTER",
        {
            "HTTP-Referer": "https://github.com/AxeH666/nightjar",
            "X-Title": "Nightjar",
        },
    ),
}

ALLOWED_SIZES = ("1024x1024", "1792x1024", "1024x1792", "512x512", "256x256")


def resolve_image_backend(
    env: Optional[Dict[str, str]] = None,
) -> Tuple[Optional[str], Optional[str], Optional[Dict[str, str]], str]:
    """Return (base_url, model, headers, provider_label) for image generation.

    (None, None, None, "none") when no backend is available — the tool then
    reports that plainly instead of failing cryptically or routing somewhere
    the user didn't pick.

    NIGHTJAR_IMAGE_BASE_URL overrides the provider's base URL (used by the mock
    e2e test, and lets a self-hosted OpenAI-compatible endpoint serve images).
    """
    e = os.environ if env is None else env
    provider = (e.get("NIGHTJAR_IMAGE_PROVIDER") or "").strip().lower()
    if not provider or provider in ("local", "none", "offline"):
        return (None, None, None, "none")
    spec = IMAGE_PROVIDERS.get(provider)
    if spec is None:
        return (None, None, None, "none")  # unknown provider -> no silent guessing
    base_url, default_model, key_var, extra = spec
    key = (e.get(key_var) or "").strip()
    if not key:
        return (None, None, None, "none")  # selected but keyless -> honest none
    base_url = (e.get("NIGHTJAR_IMAGE_BASE_URL") or base_url).strip()
    model = (e.get("NIGHTJAR_IMAGE_MODEL") or default_model).strip()
    headers = {"Authorization": f"Bearer {key}"}
    headers.update(extra)
    return (base_url, model, headers, provider)


def build_payload(prompt: str, model: str, size: str) -> Dict[str, Any]:
    """The /images/generations request body.

    Deliberately does NOT send response_format: dall-e models accept it but
    gpt-image-* rejects it (400) and returns b64 by default — so we omit it and
    parse EITHER shape from the response instead.
    """
    if size not in ALLOWED_SIZES:
        size = "1024x1024"
    return {"model": model, "prompt": prompt, "n": 1, "size": size}


def parse_image_response(data: Dict[str, Any]) -> Tuple[Optional[bytes], Optional[str]]:
    """Return (png_bytes, None) for a b64 answer, (None, url) for a URL answer.

    (None, None) means the response carried neither — the caller reports the
    shape error rather than writing an empty file.
    """
    try:
        item = data["data"][0]
    except (KeyError, IndexError, TypeError):
        return (None, None)
    b64 = item.get("b64_json")
    if b64:
        try:
            return (base64.b64decode(b64, validate=True), None)
        except (binascii.Error, ValueError):
            return (None, None)
    url = item.get("url")
    if url and isinstance(url, str) and url.startswith(("http://", "https://")):
        return (None, url)
    return (None, None)


def output_path(out_dir: Optional[Path] = None, now: Optional[datetime] = None) -> Path:
    """Where a generated image lands: ~/.nightjar/images/img_<utc-stamp>.png."""
    d = out_dir or Path(os.environ.get("NIGHTJAR_IMAGE_OUT_DIR")
                        or (Path.home() / ".nightjar" / "images"))
    d.mkdir(parents=True, exist_ok=True)
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%d-%H%M%S-%f")
    return d / f"img_{stamp}.png"


_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_JPEG_MAGIC = b"\xff\xd8\xff"
_WEBP_RE = re.compile(rb"^RIFF....WEBP", re.DOTALL)


def looks_like_image(body: bytes) -> bool:
    """Cheap sanity check before writing to disk — an HTML error page or a JSON
    error body must not be saved as a .png and reported as success."""
    return (body.startswith(_PNG_MAGIC) or body.startswith(_JPEG_MAGIC)
            or bool(_WEBP_RE.match(body)))
