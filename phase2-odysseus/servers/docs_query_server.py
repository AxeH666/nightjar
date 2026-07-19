#!/usr/bin/env python
"""Nightjar MCP wrapper: Odysseus document RAG retrieval.

Odysseus's direct `rag` MCP server can list/add/remove indexed directories but
CANNOT retrieve. This wrapper exposes `DocsService.query()` so OpenCode can
actually search indexed documents. Embedded ChromaDB (local, no docker).
"""
from __future__ import annotations

import _bootstrap  # sets sys.path + env (must be first)

import asyncio
import os

from mcp.server.fastmcp import FastMCP

from services.docs.service import DocsService

mcp = FastMCP("odysseus-docs")
_service = DocsService()

# Rule 3 (P2-3): query() embeds via the Ollama /v1/embeddings HTTP endpoint before the local Chroma
# lookup, so a wedged Ollama would otherwise hang this forever (the MCP client's 120s cap was the
# only backstop). Bound it and degrade honestly — matching the deep_research / web_search tools.
DOCS_QUERY_TIMEOUT_S = float(os.environ.get("NIGHTJAR_DOCS_QUERY_TIMEOUT_S", "30"))


@mcp.tool()
async def document_search(query: str, top_k: int = 5) -> list[dict]:
    """Search the user's indexed personal documents (RAG retrieval) and return
    the most relevant chunks with their source + score."""
    try:
        chunks = await asyncio.wait_for(_service.query(query, top_k=top_k), timeout=DOCS_QUERY_TIMEOUT_S)
    except asyncio.TimeoutError:
        return [{
            "text": f"(document search timed out after {DOCS_QUERY_TIMEOUT_S:.0f}s — the embedding backend may be unavailable)",
            "source": {},
            "score": 0.0,
        }]
    out = []
    for c in chunks:
        out.append({
            "text": getattr(c, "text", getattr(c, "content", "")),
            "source": getattr(c, "source", getattr(c, "metadata", {})),
            "score": round(float(getattr(c, "score", 0) or 0), 3),
        })
    return out


@mcp.tool()
def document_stats() -> dict:
    """Report indexed-document stats (counts, index location)."""
    return _service.get_stats()


if __name__ == "__main__":
    mcp.run()
