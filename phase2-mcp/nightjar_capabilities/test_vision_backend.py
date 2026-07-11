#!/usr/bin/env python
# Offline unit test for the vision backend selector (resolve_vision_backend).
# Pure logic — no row_bot / Ollama / network. Proves the Offline default, that a stored
# BYOK key alone never routes cloud, and explicit Online selection. Imported directly
# (not via the package) so it needs no _vendor shim. Run: python3 test_vision_backend.py
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vision_backend import resolve_vision_backend

fails = []
total = 0


def check(name, cond, got=""):
    global total
    total += 1
    print(f"{'PASS' if cond else 'FAIL'}: {name}{'' if cond else f'  (got {got})'}")
    if not cond:
        fails.append(name)


# 1) no env → local (Offline default).
check("no env → local", resolve_vision_backend({}) == ("local", None, None, None))

# 2) a stored key ALONE (no explicit provider) → local (no silent cloud).
check("keys alone → local", resolve_vision_backend({"NIGHTJAR_BYOK_OPENAI": "sk", "NIGHTJAR_BYOK_OPENROUTER": "k"}) == ("local", None, None, None))

# 3) explicit provider + key → that provider's OpenAI-compatible endpoint.
b, url, model, key = resolve_vision_backend({"NIGHTJAR_VISION_PROVIDER": "openai", "NIGHTJAR_BYOK_OPENAI": "sk-oa"})
check("openai + key → openai", b == "openai" and url == "https://api.openai.com/v1" and model == "gpt-4o-mini" and key == "sk-oa", f"{b}:{url}:{model}")
b, url, model, key = resolve_vision_backend({"NIGHTJAR_VISION_PROVIDER": "openrouter", "NIGHTJAR_BYOK_OPENROUTER": "sk-or"})
check("openrouter + key → openrouter", b == "openrouter" and url == "https://openrouter.ai/api/v1" and key == "sk-or", f"{b}:{url}")

# 4) explicit provider but MISSING key → local (safe degrade).
check("provider selected, no key → local", resolve_vision_backend({"NIGHTJAR_VISION_PROVIDER": "openai"}) == ("local", None, None, None))

# 5) unsupported provider (e.g. anthropic — not OpenAI-compatible vision here) → local.
check("unsupported provider → local", resolve_vision_backend({"NIGHTJAR_VISION_PROVIDER": "anthropic", "NIGHTJAR_BYOK_ANTHROPIC": "k"}) == ("local", None, None, None))

# 6) explicit local + key → local.
check("PROVIDER=local forces local", resolve_vision_backend({"NIGHTJAR_VISION_PROVIDER": "local", "NIGHTJAR_BYOK_OPENAI": "sk"}) == ("local", None, None, None))

# 7) cloud model override.
b, url, model, key = resolve_vision_backend({"NIGHTJAR_VISION_PROVIDER": "openai", "NIGHTJAR_BYOK_OPENAI": "sk", "NIGHTJAR_VISION_CLOUD_MODEL": "gpt-4o"})
check("vision cloud model override", model == "gpt-4o", model)

print(f"\n==== vision backend: {total - len(fails)}/{total} passed ====")
sys.exit(1 if fails else 0)
