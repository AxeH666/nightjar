#!/usr/bin/env python
# Offline unit test for the browser-use MCP model resolver (resolve_model_spec).
# Pure logic — no browser_use, no network. Proves EXPLICIT selection (offline default;
# a stored BYOK key alone never routes cloud — the silent-cloud leak is closed) and env
# overrides. Run: browser-use-mcp/venv/bin/python test_model_resolution.py
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import resolve_model_spec

fails = []
total = 0


def check(name, cond, got=""):
    global total
    total += 1
    print(f"{'PASS' if cond else 'FAIL'}: {name}{'' if cond else f'  (got {got})'}")
    if not cond:
        fails.append(name)


# 1) no keys → local llama.cpp default (offline-first baseline)
s = resolve_model_spec({})
check("no keys → local", s.provider == "local" and s.base_url == "http://127.0.0.1:8086/v1"
      and s.model == "qwen3-4b-instruct-2507", f"{s.provider}:{s.base_url}:{s.model}")

# 2) LEAK CLOSED: a stored key ALONE (no explicit PROVIDER) → local, NOT cloud.
s = resolve_model_spec({"NIGHTJAR_BYOK_OPENROUTER": "sk-or-x"})
check("openrouter key alone → local (leak closed)", s.provider == "local", s.provider)
s = resolve_model_spec({"NIGHTJAR_BYOK_OPENAI": "sk-oa"})
check("openai key alone → local (leak closed)", s.provider == "local", s.provider)
# both keys, no explicit selection → still local (the old precedence would have gone cloud)
s = resolve_model_spec({"NIGHTJAR_BYOK_OPENROUTER": "k1", "NIGHTJAR_BYOK_OPENAI": "k2"})
check("both keys, no PROVIDER → local (no precedence)", s.provider == "local", s.provider)

# 3) EXPLICIT Online selection routes to exactly the chosen provider (with its key).
s = resolve_model_spec({"NIGHTJAR_BROWSERUSE_PROVIDER": "openrouter", "NIGHTJAR_BYOK_OPENROUTER": "sk-or-x"})
check("PROVIDER=openrouter + key → openrouter", s.provider == "openrouter"
      and s.base_url == "https://openrouter.ai/api/v1" and s.model == "openai/gpt-4o-mini"
      and s.api_key == "sk-or-x" and "HTTP-Referer" in s.headers, f"{s.provider}:{s.model}")
s = resolve_model_spec({"NIGHTJAR_BROWSERUSE_PROVIDER": "openai", "NIGHTJAR_BYOK_OPENAI": "sk-oa"})
check("PROVIDER=openai + key → openai", s.provider == "openai"
      and s.base_url == "https://api.openai.com/v1" and s.model == "gpt-4o-mini", f"{s.provider}:{s.model}")
# Explicit selection honors EXACTLY the chosen provider even when the OTHER key exists
# (no OpenRouter-over-OpenAI precedence).
s = resolve_model_spec({"NIGHTJAR_BROWSERUSE_PROVIDER": "openai",
                        "NIGHTJAR_BYOK_OPENAI": "sk-oa", "NIGHTJAR_BYOK_OPENROUTER": "k1"})
check("PROVIDER=openai wins over a present OpenRouter key", s.provider == "openai", s.provider)

# 4) Selected cloud provider but its key is MISSING → local (non-silent: disclosed in
#    the tool result line). The UI blocks this, but the resolver degrades safely.
s = resolve_model_spec({"NIGHTJAR_BROWSERUSE_PROVIDER": "openrouter"})
check("PROVIDER=openrouter, no key → local (safe degrade)", s.provider == "local", s.provider)

# 5) PREFER=local still forces local even if an Online provider was selected (legacy).
s = resolve_model_spec({"NIGHTJAR_BROWSERUSE_PROVIDER": "openrouter",
                        "NIGHTJAR_BYOK_OPENROUTER": "k1", "NIGHTJAR_BROWSERUSE_PREFER": "local"})
check("prefer=local forces local", s.provider == "local", s.provider)

# 6) explicit override wins over everything
s = resolve_model_spec({
    "NIGHTJAR_BROWSERUSE_BASE_URL": "http://127.0.0.1:9999/v1",
    "NIGHTJAR_BROWSERUSE_MODEL": "my-model",
    "NIGHTJAR_BROWSERUSE_API_KEY": "sk-custom",
    "NIGHTJAR_BYOK_OPENROUTER": "k1",  # ignored
})
check("override wins", s.provider == "override" and s.model == "my-model"
      and s.api_key == "sk-custom", f"{s.provider}:{s.model}")

# 7) per-provider model override env (requires the explicit provider selection)
s = resolve_model_spec({"NIGHTJAR_BROWSERUSE_PROVIDER": "openrouter", "NIGHTJAR_BYOK_OPENROUTER": "k1",
                        "NIGHTJAR_BROWSERUSE_OPENROUTER_MODEL": "anthropic/claude-3.5-sonnet"})
check("openrouter model override", s.model == "anthropic/claude-3.5-sonnet", s.model)

# 8) local endpoint override
s = resolve_model_spec({"NIGHTJAR_LLM_ENDPOINT": "http://host:1234/v1", "NIGHTJAR_LLM_MODEL": "qwen-x"})
check("local endpoint override", s.provider == "local" and s.base_url == "http://host:1234/v1"
      and s.model == "qwen-x", f"{s.base_url}:{s.model}")

print(f"\n==== model resolution: {total - len(fails)}/{total} passed ====")
sys.exit(1 if fails else 0)
