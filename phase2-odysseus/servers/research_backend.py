"""Pure LLM-backend selection for Nightjar Deep Research.

Kept dependency-free (no DeepResearcher / odysseus imports) so it's unit-testable
offline. Mirrors the browser agent's model: the DEFAULT is the LOCAL llama-server, and
a stored BYOK key ALONE never routes research to the cloud. Only an EXPLICIT
NIGHTJAR_RESEARCH_PROVIDER (set by Nightjar from the research capability pref) plus that
provider's key routes Online — to EXACTLY that provider. A selected-but-keyless provider
degrades to local (the returned `backend` reflects what actually ran — never silent).
"""
from __future__ import annotations

import os
from typing import Dict, Optional, Tuple

# provider id → (base_url, default model, BYOK env var, extra headers). OpenAI-COMPATIBLE
# providers only — DeepResearcher speaks one base_url + Bearer, so Anthropic/Google (which
# use different APIs) are intentionally excluded (and not offered in the capability UI).
# For OpenRouter we pre-set Nightjar attribution headers so Odysseus's llm_core does NOT
# inject its own `pewdiepie-archdaemon` / `Odysseus` branding via setdefault (identity
# rule); the general fix to that default lives in a later PR.
RESEARCH_PROVIDERS: Dict[str, Tuple[str, str, str, Dict[str, str]]] = {
    "openai": ("https://api.openai.com/v1", "gpt-4o-mini", "NIGHTJAR_BYOK_OPENAI", {}),
    "openrouter": (
        "https://openrouter.ai/api/v1",
        "openai/gpt-4o-mini",
        "NIGHTJAR_BYOK_OPENROUTER",
        {
            "HTTP-Referer": "https://github.com/AxeH666/nightjar",
            "X-Title": "Nightjar",
            "X-OpenRouter-Title": "Nightjar",
        },
    ),
    "groq": ("https://api.groq.com/openai/v1", "llama-3.3-70b-versatile", "NIGHTJAR_BYOK_GROQ", {}),
    "deepseek": ("https://api.deepseek.com/v1", "deepseek-chat", "NIGHTJAR_BYOK_DEEPSEEK", {}),
    "mistral": ("https://api.mistral.ai/v1", "mistral-large-latest", "NIGHTJAR_BYOK_MISTRAL", {}),
    "xai": ("https://api.x.ai/v1", "grok-2-latest", "NIGHTJAR_BYOK_XAI", {}),
    # Fireworks AI (OpenAI-compatible). Model id MUST be the account-scoped path. The
    # serverless catalog rotates — a retired model 404s; keep this pinned to a live id
    # (verify against `curl :4096/config/providers`).
    "fireworks-ai": (
        "https://api.fireworks.ai/inference/v1",
        "accounts/fireworks/models/gpt-oss-120b",
        "NIGHTJAR_BYOK_FIREWORKS",
        {},
    ),
}


def resolve_research_llm(
    env: Optional[Dict[str, str]] = None,
) -> Tuple[str, str, Optional[Dict[str, str]], str]:
    """Return (endpoint, model, headers, backend) for a deep-research run.

    DEFAULT = the local llama-server (headers None → unauthenticated local call). Online
    only via an explicit NIGHTJAR_RESEARCH_PROVIDER + that provider's key. `backend` is
    the label of what actually ran ("local" or the provider id) for transparency.
    """
    e = os.environ if env is None else env
    local_endpoint = (e.get("NIGHTJAR_RESEARCH_LLM_ENDPOINT") or "http://127.0.0.1:8085/v1").strip()
    local_model = (e.get("NIGHTJAR_LLM_MODEL") or "qwen3-4b-instruct-2507").strip()
    local: Tuple[str, str, Optional[Dict[str, str]], str] = (local_endpoint, local_model, None, "local")

    provider = (e.get("NIGHTJAR_RESEARCH_PROVIDER") or "").strip().lower()
    if not provider or provider == "local":
        return local
    spec = RESEARCH_PROVIDERS.get(provider)
    if spec is None:
        return local  # unknown/unsupported provider → local (safe default)
    base_url, default_model, key_var, extra = spec
    key = (e.get(key_var) or "").strip()
    if not key:
        return local  # selected but no key → local (safe degrade, disclosed via backend)
    model = (e.get("NIGHTJAR_RESEARCH_MODEL") or default_model).strip()
    headers = {"Authorization": f"Bearer {key}"}
    headers.update(extra)
    return (base_url, model, headers, provider)
