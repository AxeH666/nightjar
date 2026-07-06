"""Nightjar capabilities — shared config & data paths.

Original data-path concept derived from Row-Bot (Apache-2.0); modified for
Nightjar: single ~/.nightjar root, no Row-Bot config coupling.
"""
from __future__ import annotations

import os
from pathlib import Path

DATA_ROOT = Path(os.environ.get("NIGHTJAR_DATA_DIR", str(Path.home() / ".nightjar")))

MEMORY_DB = DATA_ROOT / "memory.db"
MEMORY_INDEX = DATA_ROOT / "memory_vectors"
BROWSER_PROFILE = DATA_ROOT / "browser_profile"
MODELS_DIR = DATA_ROOT / "models"

# Local Ollama endpoint (reused across vision + embeddings).
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
EMBED_MODEL = os.environ.get("NIGHTJAR_EMBED_MODEL", "nomic-embed-text")
VISION_MODEL = os.environ.get("NIGHTJAR_VISION_MODEL", "gemma3:4b")

# Voice / wake-word.
WHISPER_SIZE = os.environ.get("NIGHTJAR_WHISPER_SIZE", "base.en")
WAKE_WORD = os.environ.get("NIGHTJAR_WAKE_WORD", "hey_nightjar")

# Side-channel + MCP.
WS_HOST = os.environ.get("NIGHTJAR_WS_HOST", "127.0.0.1")
WS_PORT = int(os.environ.get("NIGHTJAR_WS_PORT", "8765"))


def ensure_dirs() -> None:
    for p in (DATA_ROOT, MEMORY_INDEX, BROWSER_PROFILE, MODELS_DIR):
        p.mkdir(parents=True, exist_ok=True)
