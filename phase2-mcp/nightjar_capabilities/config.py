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

# Local Ollama endpoint (reused across vision + embeddings). 127.0.0.1, not localhost:
# on Windows `localhost` can resolve to IPv6 ::1 and dead-hop past Ollama's IPv4 bind,
# silently failing vision/embeddings (P3-6).
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
EMBED_MODEL = os.environ.get("NIGHTJAR_EMBED_MODEL", "nomic-embed-text")
VISION_MODEL = os.environ.get("NIGHTJAR_VISION_MODEL", "gemma3:4b")

# Voice / wake-word.
WHISPER_SIZE = os.environ.get("NIGHTJAR_WHISPER_SIZE", "base.en")
# NJ-78: there was a `WAKE_WORD = os.environ.get("NIGHTJAR_WAKE_WORD", "hey_nightjar")` here.
# It was DELETED, not wired: it had zero consumers anywhere in the tree (confirmed by a
# gitignore-blind byte scan, and `git log -S` shows it never had one in any revision — it
# arrived dead in the squashed import). Setting NIGHTJAR_WAKE_WORD changed nothing and warned
# about nothing: a knob that lies.
#
# Wiring it would have been worse than deleting it, because the wake word is selected TWICE
# and by neither a phrase nor this name:
#   * which MODEL listens — wakeword.resolve_model_path(), by PATH, via NIGHTJAR_WAKEWORD_MODEL
#     (a DIFFERENT variable; do not conflate the two)
#   * which PHRASES are stripped from a transcript — wake_daemon.WAKE_PHRASES, a deliberate
#     tuple that still includes the legacy "hey nightjar" and is asserted by
#     tests/test_wake_capture.py
# Adding a third, phrase-shaped selector would have overlapped both. If a phrase-level knob is
# ever wanted, it belongs on WAKE_PHRASES with that test moved in the same commit.

# Side-channel + MCP.
WS_HOST = os.environ.get("NIGHTJAR_WS_HOST", "127.0.0.1")
WS_PORT = int(os.environ.get("NIGHTJAR_WS_PORT", "8765"))


def ensure_dirs() -> None:
    for p in (DATA_ROOT, MEMORY_INDEX, BROWSER_PROFILE, MODELS_DIR):
        p.mkdir(parents=True, exist_ok=True)
