"""Pure backend selection for Nightjar vision (image analysis).

Dependency-free (only `os`) so it's unit-testable offline, and importable WITHOUT the
_vendor/row_bot shim. Mirrors the browser/research model: the DEFAULT is local Ollama,
and a stored BYOK key ALONE never routes vision to the cloud. Only an EXPLICIT
NIGHTJAR_VISION_PROVIDER (set by Nightjar from the vision capability pref) plus that
provider's key routes Online.

OpenAI-COMPATIBLE vision endpoints only — OpenRouter reaches Claude / Gemini vision
models through its unified /chat/completions API, so we don't need Anthropic/Google's
native (differently-shaped) vision APIs here.
"""
import os
from typing import Dict, Optional, Tuple

# provider id → (base_url, default vision model, BYOK env var)
VISION_PROVIDERS: Dict[str, Tuple[str, str, str]] = {
    "openai": ("https://api.openai.com/v1", "gpt-4o-mini", "NIGHTJAR_BYOK_OPENAI"),
    "openrouter": ("https://openrouter.ai/api/v1", "openai/gpt-4o-mini", "NIGHTJAR_BYOK_OPENROUTER"),
}


def resolve_vision_backend(
    env: Optional[Dict[str, str]] = None,
) -> Tuple[str, Optional[str], Optional[str], Optional[str]]:
    """Return (backend, base_url, model, key).

    backend == "local" (with base_url/model/key None) for Offline, an unsupported
    provider, or a selected-but-keyless provider (safe degrade to on-device Ollama).
    Otherwise the provider id + its OpenAI-compatible endpoint/model/key for an explicit
    Online cloud-vision call.
    """
    e = os.environ if env is None else env
    provider = (e.get("NIGHTJAR_VISION_PROVIDER") or "").strip().lower()
    if not provider or provider == "local":
        return ("local", None, None, None)
    spec = VISION_PROVIDERS.get(provider)
    if spec is None:
        return ("local", None, None, None)
    base_url, default_model, key_var = spec
    key = (e.get(key_var) or "").strip()
    if not key:
        return ("local", None, None, None)  # selected but no key → local
    model = (e.get("NIGHTJAR_VISION_CLOUD_MODEL") or default_model).strip()
    return (provider, base_url, model, key)
