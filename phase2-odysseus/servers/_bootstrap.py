"""Shared bootstrap for Nightjar's Odysseus wrapper MCP servers.

These wrappers run in the Odysseus sidecar venv and import Odysseus's service
classes / ORM directly (bridge, not merge). This sets the Odysseus repo on
sys.path and applies the local-first env defaults (embedded ChromaDB, data dir).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

# Repo-relative default (no hardcoded machine path): NIGHTJAR_ROOT if set, else
# derive the repo root from this file's location (…/phase2-odysseus/servers/).
_REPO_ROOT = (
    Path(os.environ["NIGHTJAR_ROOT"])
    if os.environ.get("NIGHTJAR_ROOT")
    else Path(__file__).resolve().parents[2]
)
ODYSSEUS_REPO = os.environ.get("ODYSSEUS_REPO", str(_REPO_ROOT / "research" / "odysseus"))
DATA_DIR = os.environ.get(
    "ODYSSEUS_DATA_DIR", str(Path.home() / ".nightjar" / "odysseus")
)

# local-first defaults — embedded ChromaDB, no docker service
os.environ.setdefault("ODYSSEUS_DATA_DIR", DATA_DIR)
os.environ.setdefault("CHROMADB_PERSIST_DIR", str(Path(DATA_DIR) / "chroma"))
# Deep Research: use the DuckDuckGo provider (no SearXNG docker service)
os.environ.setdefault("SEARCH_PROVIDER", "duckduckgo")
# Embeddings: reuse the same local Ollama model Row-Bot uses (nomic-embed-text),
# so both memory systems share ONE local embedding backend. Ollama exposes an
# OpenAI-compatible /v1/embeddings endpoint. Fully offline (Ollama is required
# already); avoids a second ONNX model download.
os.environ.setdefault("EMBEDDING_URL", "http://127.0.0.1:11434/v1/embeddings")
os.environ.setdefault("EMBEDDING_MODEL", "nomic-embed-text")

Path(DATA_DIR).mkdir(parents=True, exist_ok=True)

if ODYSSEUS_REPO not in sys.path:
    sys.path.insert(0, ODYSSEUS_REPO)

# local model endpoint for LLM-backed capabilities (research), OpenAI-compatible
LLM_ENDPOINT = os.environ.get("NIGHTJAR_LLM_ENDPOINT", "http://127.0.0.1:8086/v1")
LLM_MODEL = os.environ.get("NIGHTJAR_LLM_MODEL", "qwen3-4b-instruct-2507")

# owner scope (single-user Nightjar)
OWNER = os.environ.get("ODYSSEUS_MCP_MEMORY_OWNER", "nightjar")
