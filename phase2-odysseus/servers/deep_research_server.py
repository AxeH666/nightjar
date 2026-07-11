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

import asyncio
import os

import _bootstrap  # sets sys.path + env (must be first)
from mcp.server.fastmcp import FastMCP

from research_backend import resolve_research_llm  # pure backend selector (Offline default)
from src.deep_research import DeepResearcher

mcp = FastMCP("odysseus-research")


@mcp.tool()
async def deep_research(topic: str, max_time: int = 90) -> dict:
    """Research a topic on the web (DuckDuckGo) and synthesize a short cited summary.

    Backend is the user's EXPLICIT research choice (Offline default): local llama-server,
    or an Online provider set via the research capability pref. Tuned to complete on a
    small local model — shallow (1 round, few sources) and fast. `max_time` caps seconds.
    """
    endpoint, model, headers, backend = resolve_research_llm()
    r = DeepResearcher(
        llm_endpoint=endpoint,
        llm_model=model,
        llm_headers=headers,  # None for local; Bearer auth for an explicit Online provider
        max_rounds=int(os.environ.get("NIGHTJAR_RESEARCH_ROUNDS", "1")),
        min_rounds=1,
        max_urls_per_round=int(os.environ.get("NIGHTJAR_RESEARCH_URLS", "2")),
        max_content_chars=int(os.environ.get("NIGHTJAR_RESEARCH_CHARS", "2500")),
        max_report_tokens=int(os.environ.get("NIGHTJAR_RESEARCH_REPORT_TOKENS", "700")),
        max_time=max_time,
        search_provider="duckduckgo",
    )
    # rule 3: a HARD outer wall-clock cap around the whole run. The local path targets the
    # DIRECT :8085 (bypassing the 90s proxy) and a cloud path is slower still, so neither
    # is otherwise bounded by an external timeout — DeepResearcher's own max_time is
    # advisory, this enforces it. Grace = 30s for cleanup/synthesis past max_time.
    hard_cap = int(max_time) + 30
    try:
        report = await asyncio.wait_for(r.research(topic), timeout=hard_cap)
    except asyncio.TimeoutError:
        return {
            "topic": topic,
            "summary": f"Error: deep research timed out after {hard_cap}s (backend={backend}).",
            "sources": [],
            "source_count": 0,
            "backend": backend,
        }
    sources = [{"title": u.get("title", ""), "url": u.get("url", "")}
               for u in getattr(r, "analyzed_urls", [])]
    return {"topic": topic, "summary": report, "sources": sources, "source_count": len(sources), "backend": backend}


if __name__ == "__main__":
    mcp.run()
