#!/usr/bin/env python
# Offline unit test for the deep-research backend selector (resolve_research_llm).
# Pure logic — no DeepResearcher / odysseus / network. Proves EXPLICIT selection: the
# Offline default, that a stored BYOK key alone never routes research to the cloud, and
# that Online honors EXACTLY the chosen provider with Bearer auth (+ Nightjar OpenRouter
# attribution, not Odysseus). Run: python3 test_research_backend.py
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_backend import resolve_research_llm

fails = []
total = 0


def check(name, cond, got=""):
    global total
    total += 1
    print(f"{'PASS' if cond else 'FAIL'}: {name}{'' if cond else f'  (got {got})'}")
    if not cond:
        fails.append(name)


# 1) no env → local llama-server, unauthenticated (Offline default).
ep, model, headers, backend = resolve_research_llm({})
check("no env → local :8085, no headers", backend == "local" and ep == "http://127.0.0.1:8085/v1"
      and model == "qwen3-4b-instruct-2507" and headers is None, f"{backend}:{ep}:{headers}")

# 2) a stored key ALONE (no explicit provider) → still local (no silent cloud).
ep, model, headers, backend = resolve_research_llm({"NIGHTJAR_BYOK_OPENAI": "sk-oa", "NIGHTJAR_BYOK_OPENROUTER": "k1"})
check("keys alone → local (no silent cloud)", backend == "local" and headers is None, backend)

# 3) explicit provider + key → that provider, with Bearer auth.
ep, model, headers, backend = resolve_research_llm({"NIGHTJAR_RESEARCH_PROVIDER": "openai", "NIGHTJAR_BYOK_OPENAI": "sk-oa"})
check("PROVIDER=openai + key → openai", backend == "openai" and ep == "https://api.openai.com/v1"
      and model == "gpt-4o-mini" and headers.get("Authorization") == "Bearer sk-oa", f"{backend}:{ep}:{headers}")

# 4) OpenRouter uses NIGHTJAR attribution headers, NOT Odysseus branding.
ep, model, headers, backend = resolve_research_llm({"NIGHTJAR_RESEARCH_PROVIDER": "openrouter", "NIGHTJAR_BYOK_OPENROUTER": "sk-or"})
check("openrouter → nightjar branding + bearer",
      backend == "openrouter" and headers.get("Authorization") == "Bearer sk-or"
      and headers.get("X-OpenRouter-Title") == "Nightjar" and "nightjar" in headers.get("HTTP-Referer", ""),
      headers)

# 5) other OpenAI-compatible providers route to their base_url.
for prov, host in [("groq", "api.groq.com"), ("deepseek", "api.deepseek.com"),
                   ("mistral", "api.mistral.ai"), ("xai", "api.x.ai")]:
    keyvar = "NIGHTJAR_BYOK_" + prov.upper()
    ep, model, headers, backend = resolve_research_llm({"NIGHTJAR_RESEARCH_PROVIDER": prov, keyvar: "k"})
    check(f"{prov} → {host}", backend == prov and host in ep and headers.get("Authorization") == "Bearer k", f"{backend}:{ep}")

# 6) explicit provider but MISSING key → local (safe degrade, disclosed via backend).
ep, model, headers, backend = resolve_research_llm({"NIGHTJAR_RESEARCH_PROVIDER": "openai"})
check("provider selected, no key → local", backend == "local" and headers is None, backend)

# 7) unknown provider → local.
ep, model, headers, backend = resolve_research_llm({"NIGHTJAR_RESEARCH_PROVIDER": "anthropic", "NIGHTJAR_BYOK_ANTHROPIC": "k"})
check("unsupported provider → local", backend == "local", backend)

# 8) per-run model override.
ep, model, headers, backend = resolve_research_llm({"NIGHTJAR_RESEARCH_PROVIDER": "openai",
                                                    "NIGHTJAR_BYOK_OPENAI": "sk", "NIGHTJAR_RESEARCH_MODEL": "gpt-4o"})
check("research model override", model == "gpt-4o", model)

# 9) explicit local + keys present → local.
ep, model, headers, backend = resolve_research_llm({"NIGHTJAR_RESEARCH_PROVIDER": "local", "NIGHTJAR_BYOK_OPENAI": "sk"})
check("PROVIDER=local forces local", backend == "local" and headers is None, backend)

print(f"\n==== research backend: {total - len(fails)}/{total} passed ====")
sys.exit(1 if fails else 0)
