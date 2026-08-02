#!/usr/bin/env python
"""Nightjar MCP server: deep research. No Odysseus.

Odysseus removal, PR F. Replaces the wrapper around Odysseus's AGPL
`src/deep_research.py` with Nightjar's own loop in `deep_research_backend.py`
(written from the search → fetch → extract → synthesize pattern that Odysseus's
own ACKNOWLEDGMENTS credits to Tongyi DeepResearch, Alibaba-NLP, Apache-2.0 — no
Odysseus code copied).

Same tool name, same arguments, same return contract, same env knobs, and the
same explicit Local/Cloud backend selector (`research_backend.resolve_research_llm`)
that web search uses — so the `research` agent and the UI are unchanged.

PDF extraction uses **pypdf (BSD)**. PyMuPDF is AGPL and is deliberately NOT used.

Runs in the phase2-mcp venv, which has no Odysseus at all.
"""
from __future__ import annotations

import asyncio
import io
import os
from typing import Any, Dict, List, Optional, Sequence

import httpx
from ddgs import DDGS
from mcp.server.fastmcp import FastMCP

from deep_research_backend import (
    DEFAULT_CONTENT_CHARS,
    DEFAULT_MAX_TIME,
    DEFAULT_REPORT_TOKENS,
    DEFAULT_ROUNDS,
    DEFAULT_URLS_PER_ROUND,
    run_deep_research,
    total_budget,
)
from research_backend import resolve_research_llm
from web_search_backend import payload_extras

mcp = FastMCP("nightjar-research")

# Grace on top of the stages' own ceiling for the outer wall-clock cap (rule 3).
RESEARCH_GRACE = 30
# Pages above this are truncated before decoding — a 200 MB "page" must not be
# pulled into memory just to take 2500 chars off the front.
MAX_FETCH_BYTES = 4 * 1024 * 1024


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


async def _ddgs_search(query: str, max_results: int, timeout_s: float) -> Sequence[Dict[str, Any]]:
    """DuckDuckGo (ddgs) — sync, so run it in a worker thread under a hard timeout."""
    return await asyncio.wait_for(
        asyncio.to_thread(lambda: DDGS().text(query, max_results=max_results)),
        timeout=timeout_s,
    )


async def _fetch(url: str, timeout_s: float) -> tuple:
    """GET a page under a hard timeout, capped in size. Returns (content_type, body).

    STREAMED, not buffered: `resp.content` would read the entire body into memory
    before any slice could apply (Bugbot), so iterate chunks and stop the moment
    the cap is crossed — a 200 MB "page" costs at most MAX_FETCH_BYTES + one chunk.
    """
    async with httpx.AsyncClient(
        timeout=timeout_s, follow_redirects=True,
        headers={"User-Agent": "Nightjar/1.0 (+https://github.com/AxeH666/nightjar)"},
    ) as client:
        async with client.stream("GET", url) as resp:
            resp.raise_for_status()
            chunks: list[bytes] = []
            size = 0
            async for chunk in resp.aiter_bytes():
                chunks.append(chunk)
                size += len(chunk)
                if size >= MAX_FETCH_BYTES:
                    break
            return resp.headers.get("content-type", ""), b"".join(chunks)[:MAX_FETCH_BYTES]


def _pdf_to_text(body: bytes) -> str:
    """PDF → text via pypdf (BSD). Never PyMuPDF (AGPL). Best-effort: a corrupt or
    encrypted PDF yields '' and the source degrades to its search snippet."""
    try:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(body))
        return "\n".join((page.extract_text() or "") for page in reader.pages[:20])
    except Exception:  # noqa: BLE001
        return ""


async def _llm(
    endpoint: str, model: str, headers: Optional[Dict[str, str]], backend: str,
    messages: List[Dict[str, str]], max_tokens: int, timeout_s: float,
) -> str:
    """ONE OpenAI-compatible chat call against the resolved research backend."""
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,  # rule 3: token cap, so a repetition loop can't run unbounded
        "temperature": 0.2,
        "stream": False,
        **payload_extras(backend),  # local-only: skip the Qwen3 <think> pass
    }
    async with httpx.AsyncClient(timeout=timeout_s) as client:
        resp = await client.post(
            endpoint.rstrip("/") + "/chat/completions", json=payload, headers=headers or {},
        )
        resp.raise_for_status()
        data = resp.json()
    try:
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"unexpected chat-completions response shape: {exc}") from exc


@mcp.tool()
async def deep_research(topic: str, max_time: int = DEFAULT_MAX_TIME) -> dict:
    """Research a topic on the web (DuckDuckGo) and synthesize a short cited report.

    Backend is the user's EXPLICIT research choice (Offline default): the local
    llama-server, or an Online provider set via the research capability pref. Tuned to
    complete on a small local model — shallow (few rounds, few sources) and fast.
    `max_time` caps total seconds.
    """
    endpoint, model, headers, backend = resolve_research_llm()
    rounds = _env_int("NIGHTJAR_RESEARCH_ROUNDS", DEFAULT_ROUNDS)
    urls = _env_int("NIGHTJAR_RESEARCH_URLS", DEFAULT_URLS_PER_ROUND)
    chars = _env_int("NIGHTJAR_RESEARCH_CHARS", DEFAULT_CONTENT_CHARS)
    report_tokens = _env_int("NIGHTJAR_RESEARCH_REPORT_TOKENS", DEFAULT_REPORT_TOKENS)

    async def llm_fn(messages, max_tokens, timeout_s):
        return await _llm(endpoint, model, headers, backend, messages, max_tokens, timeout_s)

    # rule 3: a HARD outer wall-clock cap over the whole run, derived from the stages'
    # own ceiling (not the raw max_time — split_budget floors small budgets, so a raw
    # cap could be shorter than the stages are allowed to run and kill work mid-flight).
    hard_cap = total_budget(int(max_time), rounds, urls) + RESEARCH_GRACE
    try:
        return await asyncio.wait_for(
            run_deep_research(
                topic,
                search_fn=_ddgs_search,
                fetch_fn=_fetch,
                llm_fn=llm_fn,
                backend=backend,
                pdf_fn=_pdf_to_text,
                max_time=int(max_time),
                rounds=rounds,
                urls_per_round=urls,
                max_content_chars=chars,
                max_report_tokens=report_tokens,
            ),
            timeout=hard_cap,
        )
    except asyncio.TimeoutError:
        return {
            "topic": topic,
            "summary": f"Error: deep research timed out after {hard_cap}s (backend={backend}).",
            "sources": [],
            "source_count": 0,
            "backend": backend,
        }


if __name__ == "__main__":
    mcp.run()
