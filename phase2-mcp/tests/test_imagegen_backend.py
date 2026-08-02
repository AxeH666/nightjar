#!/usr/bin/env python
"""Offline unit test for the image-generation backend (imagegen_backend).

Pure logic — no network, no MCP. The load-bearing assertions mirror the
research/browser capability rules:
  KEY_ALONE_NEVER_ROUTES — a stored BYOK key without the explicit provider
                           selection must resolve to "none"
  EXPLICIT_ONLY          — an unknown/absent provider never guesses
  NON_IMAGE_NOT_SAVED    — an HTML/JSON error body must not pass the image check
Run: python3 tests/test_imagegen_backend.py
"""
import base64
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from imagegen_backend import (  # noqa: E402
    ALLOWED_SIZES,
    build_payload,
    looks_like_image,
    parse_image_response,
    resolve_image_backend,
)

fails = []


def check(name, cond, got=""):
    print(f"{'PASS' if cond else 'FAIL'}: {name}{'' if cond else f'  (got {got!r})'}")
    if not cond:
        fails.append(name)


# ---------------- resolution rules ----------------
check("KEY_ALONE_NEVER_ROUTES — key present, no selection -> none",
      resolve_image_backend({"NIGHTJAR_BYOK_OPENAI": "sk-x"})[3] == "none")
check("no selection, no key -> none", resolve_image_backend({})[3] == "none")
check("offline/local selection -> none (no local path since PR G)",
      resolve_image_backend({"NIGHTJAR_IMAGE_PROVIDER": "local",
                             "NIGHTJAR_BYOK_OPENAI": "sk-x"})[3] == "none")
check("EXPLICIT_ONLY — unknown provider -> none, never guesses",
      resolve_image_backend({"NIGHTJAR_IMAGE_PROVIDER": "anthropic",
                             "NIGHTJAR_BYOK_OPENAI": "sk-x"})[3] == "none")
check("selected but keyless -> none",
      resolve_image_backend({"NIGHTJAR_IMAGE_PROVIDER": "openai"})[3] == "none")

url, model, headers, prov = resolve_image_backend(
    {"NIGHTJAR_IMAGE_PROVIDER": "openai", "NIGHTJAR_BYOK_OPENAI": "sk-test"})
check("openai selected + key -> openai", prov == "openai")
check("openai default model", model == "dall-e-3", model)
check("bearer auth built", headers["Authorization"] == "Bearer sk-test")

url2, model2, headers2, prov2 = resolve_image_backend(
    {"NIGHTJAR_IMAGE_PROVIDER": "openrouter", "NIGHTJAR_BYOK_OPENROUTER": "sk-or"})
check("openrouter routes to openrouter", prov2 == "openrouter" and "openrouter.ai" in url2)
check("openrouter carries Nightjar attribution headers",
      headers2.get("X-Title") == "Nightjar", headers2)

url3, *_ = resolve_image_backend(
    {"NIGHTJAR_IMAGE_PROVIDER": "openai", "NIGHTJAR_BYOK_OPENAI": "k",
     "NIGHTJAR_IMAGE_BASE_URL": "http://127.0.0.1:9999/v1"})
check("base-url override honored (mock/self-hosted)", url3 == "http://127.0.0.1:9999/v1")

m_override = resolve_image_backend(
    {"NIGHTJAR_IMAGE_PROVIDER": "openai", "NIGHTJAR_BYOK_OPENAI": "k",
     "NIGHTJAR_IMAGE_MODEL": "gpt-image-1"})[1]
check("model override honored", m_override == "gpt-image-1")

# ---------------- payload ----------------
p = build_payload("a cat", "dall-e-3", "1792x1024")
check("payload carries prompt/model/size/n", p == {"model": "dall-e-3", "prompt": "a cat",
                                                   "n": 1, "size": "1792x1024"})
check("payload omits response_format (gpt-image-* rejects it)", "response_format" not in p)
check("bad size falls back to 1024x1024", build_payload("x", "m", "999x1")["size"] == "1024x1024")
check("all allowed sizes accepted", all(build_payload("x", "m", s)["size"] == s for s in ALLOWED_SIZES))

# ---------------- response parsing ----------------
png = b"\x89PNG\r\n\x1a\n" + b"fake"
b64 = base64.b64encode(png).decode()
body, u = parse_image_response({"data": [{"b64_json": b64}]})
check("b64_json decoded", body == png)
body2, u2 = parse_image_response({"data": [{"url": "https://cdn.example/img.png"}]})
check("url shape passed through", body2 is None and u2 == "https://cdn.example/img.png")
check("garbage b64 -> (None, None)", parse_image_response({"data": [{"b64_json": "!!"}]}) == (None, None))
check("empty data -> (None, None)", parse_image_response({"data": []}) == (None, None))
check("missing data -> (None, None)", parse_image_response({}) == (None, None))
check("non-http url rejected", parse_image_response({"data": [{"url": "file:///etc/passwd"}]}) == (None, None))

# ---------------- image sniffing ----------------
check("PNG magic accepted", looks_like_image(png))
check("JPEG magic accepted", looks_like_image(b"\xff\xd8\xff\xe0rest"))
check("NON_IMAGE_NOT_SAVED — HTML error page rejected",
      not looks_like_image(b"<html><body>402 Payment Required</body></html>"))
check("NON_IMAGE_NOT_SAVED — JSON error body rejected",
      not looks_like_image(b'{"error": {"message": "billing"}}'))

print()
print("FAILED: " + ", ".join(fails) if fails else f"all passed")
sys.exit(1 if fails else 0)
