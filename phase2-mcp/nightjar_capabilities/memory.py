"""Nightjar memory capability — clean wrapper over the vendored Row-Bot
knowledge-graph engine (SQLite + FAISS + NetworkX), embeddings via Ollama.

Exposes the small surface the MCP server needs; all heavy lifting is the
faithfully-preserved Row-Bot engine in _vendor/row_bot/knowledge_graph.py.
"""
from __future__ import annotations

from typing import List, Dict, Any, Optional

import nightjar_capabilities  # noqa: F401  (bootstraps the _vendor shim on sys.path)
import row_bot.knowledge_graph as _kg


def save_memory(content: str, subject: Optional[str] = None, kind: str = "note",
                tags: str = "") -> Dict[str, Any]:
    """Persist a memory. `subject` defaults to a short slice of the content."""
    subj = (subject or content[:60]).strip()
    return _kg.save_entity(kind, subj, description=content, tags=tags, source="mcp")


def search_memory(query: str, limit: int = 5, threshold: float = 0.25) -> List[Dict[str, Any]]:
    """Hybrid recall: semantic (FAISS) + keyword (FTS) + 1-hop graph expansion."""
    res = _kg.retrieve_memory_candidates(query, top_k=limit, threshold=threshold,
                                         max_results=limit, include_keyword=True)
    out = []
    for r in res[:limit]:
        out.append({
            "id": r.get("id"),
            "subject": r.get("subject"),
            "content": r.get("description"),
            "kind": r.get("entity_type"),
            "score": round(float(r.get("score", r.get("similarity", 0)) or 0), 3),
        })
    return out


def list_memory(limit: int = 50) -> List[Dict[str, Any]]:
    return _kg.list_entity_summaries(limit=limit)


def delete_memory(memory_id: str) -> bool:
    return _kg.delete_entity(memory_id)


def count_memory() -> int:
    return _kg.count_entities()
