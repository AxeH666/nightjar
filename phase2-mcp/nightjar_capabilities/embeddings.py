"""Local embedding backend for Nightjar memory.

Replaces Row-Bot's HuggingFace/torch embedding provider with a local Ollama
embedding model (default `nomic-embed-text`) — no torch, fully offline, reuses
the same Ollama server the rest of Nightjar already depends on.
"""
from __future__ import annotations

from functools import lru_cache
from typing import List

import requests

from . import config


def embed(text: str) -> List[float]:
    """Return the embedding vector for a single string via Ollama."""
    return embed_batch([text])[0]


def embed_batch(texts: List[str]) -> List[List[float]]:
    """Embed a batch of strings. One request per text (Ollama /api/embeddings
    is single-input); kept simple and synchronous — memory ops are low-volume."""
    out: List[List[float]] = []
    for t in texts:
        r = requests.post(
            f"{config.OLLAMA_HOST}/api/embeddings",
            json={"model": config.EMBED_MODEL, "prompt": t},
            timeout=60,
        )
        r.raise_for_status()
        out.append(r.json()["embedding"])
    return out


@lru_cache(maxsize=1)
def dim() -> int:
    """Embedding dimensionality of the configured model (probed once)."""
    return len(embed("dimension probe"))


class OllamaEmbedder:
    """Adapter exposing the two methods Row-Bot's memory engine expects from an
    embedding model (`embed_query`, `embed_documents`), backed by Ollama.
    This replaces Row-Bot's HuggingFace/torch embedding provider."""

    def embed_query(self, text: str) -> List[float]:
        return embed(text)

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return embed_batch(list(texts))
