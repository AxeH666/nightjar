#!/usr/bin/env python
"""Nightjar MCP wrapper: Odysseus Deep Research (tuned for a local small model).

PHASE 2b FIX: the default pipeline (max_rounds=8, max_content_chars=15000) sends
huge prompts to the 4B on every source, each call ~95 s — blowing past the
Phase-1.5 90 s inference proxy (HTTP 504) and never completing. Here we drive
`DeepResearcher` DIRECTLY with tight caps (1 round, few URLs, small extraction
window, short report) and point at the DIRECT llama-server (bypassing the 90 s
proxy, since DeepResearcher has its own per-call timeouts). This makes research
actually finish on a local 4B. Web search uses DuckDuckGo (ddgs) — no SearXNG
docker. Bridge, not merge.
"""
from __future__ import annotations

import os

import _bootstrap  # sets sys.path + env (must be first)
from mcp.server.fastmcp import FastMCP

from src.deep_research import DeepResearcher

mcp = FastMCP("odysseus-research")

# Research runs many LLM calls; point at the DIRECT llama-server (no 90s proxy).
RESEARCH_LLM = os.environ.get("NIGHTJAR_RESEARCH_LLM_ENDPOINT", "http://127.0.0.1:8085/v1")


@mcp.tool()
async def deep_research(topic: str, max_time: int = 90) -> dict:
    """Research a topic on the web (DuckDuckGo) and synthesize a short cited
    summary using the local model. Tuned to complete on a small local model:
    shallow (1 round, few sources) and fast. `max_time` caps seconds."""
    r = DeepResearcher(
        llm_endpoint=RESEARCH_LLM,
        llm_model=_bootstrap.LLM_MODEL,
        max_rounds=int(os.environ.get("NIGHTJAR_RESEARCH_ROUNDS", "1")),
        min_rounds=1,
        max_urls_per_round=int(os.environ.get("NIGHTJAR_RESEARCH_URLS", "2")),
        max_content_chars=int(os.environ.get("NIGHTJAR_RESEARCH_CHARS", "2500")),
        max_report_tokens=int(os.environ.get("NIGHTJAR_RESEARCH_REPORT_TOKENS", "700")),
        max_time=max_time,
        search_provider="duckduckgo",
    )
    report = await r.research(topic)
    sources = [{"title": u.get("title", ""), "url": u.get("url", "")}
               for u in getattr(r, "analyzed_urls", [])]
    return {"topic": topic, "summary": report, "sources": sources, "source_count": len(sources)}


if __name__ == "__main__":
    mcp.run()
