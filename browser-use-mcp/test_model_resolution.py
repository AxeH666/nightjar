#!/usr/bin/env python
# Offline unit test for the browser-use MCP model resolver (resolve_model_spec).
# Pure logic — no browser_use, no network. Proves the local-first + BYOK-preferred
# precedence and env overrides. Run: browser-use-mcp/venv/bin/python test_model_resolution.py
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import resolve_model_spec

fails = []


def check(name, cond, got=""):
    print(f"{'PASS' if cond else 'FAIL'}: {name}{'' if cond else f'  (got {got})'}")
    if not cond:
        fails.append(name)


# 1) no keys → local llama.cpp default (offline-first baseline)
s = resolve_model_spec({})
check("no keys → local", s.provider == "local" and s.base_url == "http://127.0.0.1:8086/v1"
      and s.model == "qwen3-4b-instruct-2507", f"{s.provider}:{s.base_url}:{s.model}")

# 2) OpenRouter key (default prefer=byok) → openrouter, with attribution headers
s = resolve_model_spec({"NIGHTJAR_BYOK_OPENROUTER": "sk-or-x"})
check("openrouter key → openrouter", s.provider == "openrouter"
      and s.base_url == "https://openrouter.ai/api/v1" and s.model == "openai/gpt-4o-mini"
      and s.api_key == "sk-or-x" and "HTTP-Referer" in s.headers, f"{s.provider}:{s.model}")

# 3) OpenAI key only → openai
s = resolve_model_spec({"NIGHTJAR_BYOK_OPENAI": "sk-oa"})
check("openai key → openai", s.provider == "openai"
      and s.base_url == "https://api.openai.com/v1" and s.model == "gpt-4o-mini", f"{s.provider}:{s.model}")

# 4) both keys → OpenRouter wins (precedence)
s = resolve_model_spec({"NIGHTJAR_BYOK_OPENROUTER": "k1", "NIGHTJAR_BYOK_OPENAI": "k2"})
check("both keys → openrouter precedence", s.provider == "openrouter", s.provider)

# 5) PREFER=local forces local even with a key present (pure-offline opt-in)
s = resolve_model_spec({"NIGHTJAR_BYOK_OPENROUTER": "k1", "NIGHTJAR_BROWSERUSE_PREFER": "local"})
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

# 7) per-provider model override env
s = resolve_model_spec({"NIGHTJAR_BYOK_OPENROUTER": "k1",
                        "NIGHTJAR_BROWSERUSE_OPENROUTER_MODEL": "anthropic/claude-3.5-sonnet"})
check("openrouter model override", s.model == "anthropic/claude-3.5-sonnet", s.model)

# 8) local endpoint override
s = resolve_model_spec({"NIGHTJAR_LLM_ENDPOINT": "http://host:1234/v1", "NIGHTJAR_LLM_MODEL": "qwen-x"})
check("local endpoint override", s.provider == "local" and s.base_url == "http://host:1234/v1"
      and s.model == "qwen-x", f"{s.base_url}:{s.model}")

print(f"\n==== model resolution: {8 - len(fails)}/8 passed ====")
sys.exit(1 if fails else 0)
