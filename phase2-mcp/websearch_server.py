#!/usr/bin/env python
"""Nightjar MCP server: quick web search. Contains NO Odysseus code.

Split out of `phase2-odysseus/servers/deep_research_server.py` (Odysseus removal,
PR B). `web_search` never touched Odysseus — it is ddgs (MIT) plus two
Nightjar-authored pure modules (`web_search_backend`, `research_backend`). It only
*broke* when Odysseus was unavailable because it shared a file with
`deep_research`, whose module-scope `from src.deep_research import DeepResearcher`
kills the whole module on import.

So this is a co-location fix, not a rewrite: the tool body is carried over
unchanged. (`deep_research` was later replaced by Nightjar's own loop in PR F —
see `research_server.py` + `deep_research_backend.py`.)

Runs in the phase2-mcp venv (Odysseus-free). `tests/test_websearch_no_odysseus.py`
import-traces this module and fails if any Odysseus module is pulled in.

LIGHTWEIGHT by design: one DuckDuckGo search + one short, token-capped LLM call
over the snippets. No page fetching, no multi-round synthesis.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional, Sequence

import httpx
from ddgs import DDGS
from mcp.server.fastmcp import FastMCP

from research_backend import resolve_research_llm  # pure backend selector (Offline default)
from web_search_backend import (  # pure orchestrator + budget math; all I/O injected
    DEFAULT_MAX_TIME,
    payload_extras,
    run_web_search,
    total_budget,
)

mcp = FastMCP("nightjar-websearch")

# Grace added on top of a tool's own budget for the outer wall-clock cap (rule 3).
WEB_SEARCH_GRACE = 10


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
    """ONE OpenAI-compatible chat call, against the resolved research backend."""
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
    # Derived from total_budget (the FLOORED total the stages may actually consume), NOT
    # from the raw max_time: split_budget floors a tiny budget up to 15s, so a raw cap
    # would be shorter than the stages are allowed to run (max_time=1 → stages 15s, raw
    # cap 11s) and this guard would kill work that was about to succeed. (Bugbot)
    hard_cap = total_budget(int(max_time)) + WEB_SEARCH_GRACE
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
