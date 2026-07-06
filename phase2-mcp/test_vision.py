#!/usr/bin/env python3
# Integration test: nightjar_capabilities.vision.analyze_image (Ollama gemma3:4b) on a
# solid-red image — proves offline image analysis works end-to-end. Skips cleanly if
# Ollama or the vision model aren't available. Run with the phase2-mcp venv:
#   phase2-mcp/venv/bin/python phase2-mcp/test_vision.py
import json
import os
import struct
import sys
import tempfile
import urllib.request
import zlib
from pathlib import Path

REPO = os.environ.get("NIGHTJAR_ROOT") or str(Path(__file__).resolve().parents[1])
sys.path.insert(0, os.path.join(REPO, "phase2-mcp"))

HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
MODEL = os.environ.get("NIGHTJAR_VISION_MODEL", "gemma3:4b")

try:
    tags = json.load(urllib.request.urlopen(HOST + "/api/tags", timeout=3))
    names = [m.get("name", "") for m in tags.get("models", [])]
except Exception as e:
    print(f"SKIP: Ollama not reachable at {HOST} ({e})")
    sys.exit(0)
if not any(n == MODEL or n.startswith(MODEL) for n in names):
    print(f"SKIP: vision model {MODEL} not pulled (have: {names})")
    sys.exit(0)


def solid_png(path: str, w: int, h: int, rgb: tuple[int, int, int]) -> None:
    def chunk(typ: bytes, data: bytes) -> bytes:
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)  # 8-bit RGB
    raw = (b"\x00" + bytes(rgb) * w) * h  # filter byte + row, ×h
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    Path(path).write_bytes(png)


tmp = tempfile.mkdtemp(prefix="njvision-")
img = os.path.join(tmp, "red.png")
solid_png(img, 256, 256, (220, 30, 30))
print(f"[test] wrote a solid-red PNG at {img}")

from nightjar_capabilities import vision  # noqa: E402

res = vision.analyze_image(img, "What is the dominant color in this image? Reply with only the color name.")
print("[analyze_image] →", repr(res)[:300])

ok = isinstance(res, str) and not res.lower().startswith("error") and "red" in res.lower()
print("\nRESULT:", "PASS ✅ — gemma3:4b analyzed the image offline" if ok else "FAIL ❌")
sys.exit(0 if ok else 1)
