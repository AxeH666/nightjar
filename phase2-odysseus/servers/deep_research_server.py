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
from typing import Any, Dict, List, Optional, Sequence

import _bootstrap  # sets sys.path + env (must be first)
import httpx
from ddgs import DDGS
from mcp.server.fastmcp import FastMCP

from research_backend import resolve_research_llm  # pure backend selector (Offline default)
from src.deep_research import DeepResearcher
from web_search_backend import DEFAULT_MAX_TIME, payload_extras, run_web_search  # pure; I/O injected

mcp = FastMCP("odysseus-research")

# Grace added on top of a tool's own budget for the outer wall-clock cap (rule 3).
WEB_SEARCH_GRACE = 10


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


# ---------------- quick web search (NOT deep research) ----------------
# A simple lookup used to route to `deep_research` → the multi-round DeepResearcher →
# a ~90s timeout on the local model. This is the lightweight path: ONE search + ONE
# short, token-capped LLM call over the snippets. It deliberately reuses this server's
# process and `resolve_research_llm`, so it follows the SAME explicit Local/Cloud
# capability pref as deep research — no new env var, no new capability.


async def _ddgs_search(query: str, max_results: int, timeout_s: float) -> Sequence[Dict[str, Any]]:
    """DuckDuckGo (ddgs) top-N, in a worker thread — ddgs is sync — under a hard timeout."""
    return await asyncio.wait_for(
        asyncio.to_thread(lambda: DDGS().text(query, max_results=max_results)),
        timeout=timeout_s,
    )


async def _llm_summarize(
    endpoint: str,
    model: str,
    headers: Optional[Dict[str, str]],
    backend: str,
    messages: List[Dict[str, str]],
    max_tokens: int,
    timeout_s: float,
) -> str:
    """ONE OpenAI-compatible chat call. Same endpoint/auth deep research resolved."""
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,  # rule 3: token cap, so a repetition loop can't run unbounded
        "temperature": 0.2,
        "stream": False,
        # Local only: turns OFF the Qwen3 <think> pass, which is 2.5x the latency of the
        # answer itself for a quick lookup. Never sent to a cloud provider (they 400 on
        # unknown params). See web_search_backend.payload_extras.
        **payload_extras(backend),
    }
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.post(
            endpoint.rstrip("/") + "/chat/completions",
            json=payload,
            headers=headers or {},  # None for local (unauthenticated); Bearer for an Online provider
        )
        resp.raise_for_status()
        data = resp.json()
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"unexpected chat-completions response shape: {exc}") from exc


@mcp.tool()
async def web_search(query: str, max_time: int = DEFAULT_MAX_TIME) -> dict:
    """Quick web lookup: search the web and answer concisely with source links.

    LIGHTWEIGHT — one DuckDuckGo search plus one short summarizing call over the result
    snippets. This is NOT deep research: no multi-round synthesis, no page fetching, no
    report. Use `deep_research` when the user asks for a full researched report; use this
    for a quick factual lookup. `max_time` caps total seconds.

    Backend is the user's EXPLICIT Local/Cloud research choice (Offline default) — the
    same selector deep research uses.
    """
    endpoint, model, headers, backend = resolve_research_llm()

    async def llm_fn(messages: List[Dict[str, str]], max_tokens: int, timeout_s: float) -> str:
        return await _llm_summarize(endpoint, model, headers, backend, messages, max_tokens, timeout_s)

    # rule 3: a HARD outer wall-clock cap over the whole tool, on top of the per-stage
    # timeouts inside run_web_search and the max_tokens cap on the generation itself.
    hard_cap = int(max_time) + WEB_SEARCH_GRACE
    try:
        return await asyncio.wait_for(
            run_web_search(
                query,
                search_fn=_ddgs_search,
                llm_fn=llm_fn,
                backend=backend,
                max_time=int(max_time),
            ),
            timeout=hard_cap,
        )
    except asyncio.TimeoutError:
        return {
            "query": query,
            "answer": f"Error: web search timed out after {hard_cap}s (backend={backend}).",
            "sources": [],
            "source_count": 0,
            "backend": backend,
        }


if __name__ == "__main__":
    mcp.run()
