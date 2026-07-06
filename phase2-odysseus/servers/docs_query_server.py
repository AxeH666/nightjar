#!/usr/bin/env python
"""Nightjar MCP wrapper: Odysseus document RAG retrieval.

Odysseus's direct `rag` MCP server can list/add/remove indexed directories but
CANNOT retrieve. This wrapper exposes `DocsService.query()` so OpenCode can
actually search indexed documents. Embedded ChromaDB (local, no docker).
"""
from __future__ import annotations

import _bootstrap  # sets sys.path + env (must be first)
from mcp.server.fastmcp import FastMCP

from services.docs.service import DocsService

mcp = FastMCP("odysseus-docs")
_service = DocsService()


@mcp.tool()
async def document_search(query: str, top_k: int = 5) -> list[dict]:
    """Search the user's indexed personal documents (RAG retrieval) and return
    the most relevant chunks with their source + score."""
    chunks = await _service.query(query, top_k=top_k)
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
