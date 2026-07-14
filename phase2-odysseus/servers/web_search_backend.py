"""Pure logic for Nightjar's lightweight `web_search` tool.

`web_search` is the QUICK lookup: one search → snippets → ONE short LLM call. It is
NOT `deep_research` — no DeepResearcher, no rounds, no page fetching. That distinction
is the whole point: a simple lookup used to route to the multi-round DeepResearcher and
blow past the ~90 s cap on the local model.

Kept dependency-free (no odysseus / DeepResearcher / httpx / ddgs imports) so every
branch is unit-testable offline, mirroring `research_backend`. Both I/O steps — the
search and the LLM call — are INJECTED as callables, so `run_web_search`'s control flow
(no query, no results, search failure, LLM timeout) is exercised by tests without ever
touching the network.

Backend selection is NOT duplicated here: the caller passes the backend resolved by
`research_backend.resolve_research_llm`, so web_search follows the same explicit
Local/Cloud capability pref as deep research, with no new env var or capability.
"""
from __future__ import annotations

import asyncio
import re
from typing import Any, Awaitable, Callable, Dict, List, Sequence

MAX_RESULTS = 5
SNIPPET_CHARS = 400  # per-result snippet cap — keeps the single prompt small
SUMMARY_MAX_TOKENS = 400  # rule 3: a token cap, so one generation can't run away
DEFAULT_MAX_TIME = 25

# Budget floors/caps (seconds). The search is the cheap half; the LLM call gets the rest.
SEARCH_CAP = 10
SEARCH_MIN = 5
LLM_MIN = 10

SYSTEM_PROMPT = (
    "You are Nightjar, an offline, local-first AI assistant, doing a QUICK web lookup. "
    "Answer the user's question directly from the numbered search results below, in at "
    "most 4 sentences. Cite the results you used inline as [1], [2], etc. If the results "
    "do not actually answer the question, say so plainly instead of guessing. Do not pad "
    "the answer, do not speculate, and do not attempt further research — this is a quick "
    "lookup, not a report."
)

# Search/LLM callables the server injects. Declared for readers, not enforced at runtime.
SearchFn = Callable[[str, int, float], Awaitable[Sequence[Dict[str, Any]]]]
LlmFn = Callable[[List[Dict[str, str]], int, float], Awaitable[str]]

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


def strip_reasoning(text: str) -> str:
    """Drop <think>…</think> blocks some Qwen builds emit, so they never reach the user."""
    return _THINK_RE.sub("", text or "").strip()


def payload_extras(backend: str) -> Dict[str, Any]:
    """Extra chat-completions params for this backend.

    Qwen3 and other hybrid-reasoning models run a <think> pass before answering. For a
    QUICK lookup that reasoning is pure latency: measured on qwen3:8b via Ollama, the same
    one-line answer took 25.3s with thinking ON vs 10.2s with it OFF — enough on its own to
    blow the summarize budget and turn a working lookup back into the timeout this tool
    exists to fix. `chat_template_kwargs` is the switch llama.cpp and Ollama both honor.

    LOCAL ONLY. Cloud providers (OpenAI, Groq, …) reject unknown request params with a 400,
    so this must never be sent to them — hence the explicit backend gate rather than
    always-on.
    """
    if backend == "local":
        return {"chat_template_kwargs": {"enable_thinking": False}}
    return {}


def split_budget(max_time: int) -> tuple[int, int]:
    """Split a total wall-clock budget into (search_seconds, llm_seconds).

    Floors the total so a caller passing a tiny/zero max_time can't hand either stage a
    0 s timeout (which would fail instantly rather than doing the cheap thing).
    """
    total = max(SEARCH_MIN + LLM_MIN, int(max_time))
    search_s = min(SEARCH_CAP, max(SEARCH_MIN, total // 3))
    return search_s, max(LLM_MIN, total - search_s)


def normalize_results(rows: Sequence[Dict[str, Any]], max_results: int = MAX_RESULTS) -> List[Dict[str, str]]:
    """ddgs rows → [{title, url, snippet}], de-duped by url, snippets truncated.

    ddgs returns `title` / `href` / `body` (verified against ddgs 9.14). Rows with no url
    are dropped — a source we can't cite is worse than no source.
    """
    out: List[Dict[str, str]] = []
    seen: set[str] = set()
    for row in rows or []:
        url = str(row.get("href") or row.get("url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        snippet = str(row.get("body") or row.get("snippet") or "").strip()
        out.append({
            "title": str(row.get("title") or "").strip() or url,
            "url": url,
            "snippet": snippet[:SNIPPET_CHARS],
        })
        if len(out) >= max_results:
            break
    return out


def build_messages(query: str, results: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    """The single chat prompt: the question + the numbered snippets. No page fetching."""
    sources = "\n\n".join(
        f"[{i}] {r['title']}\n{r['url']}\n{r['snippet']}" for i, r in enumerate(results, start=1)
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": f"Question: {query}\n\nSearch results:\n\n{sources}"},
    ]


def _result(query: str, answer: str, results: Sequence[Dict[str, str]], backend: str) -> Dict[str, Any]:
    sources = [{"title": r["title"], "url": r["url"]} for r in results]
    return {
        "query": query,
        "answer": answer,
        "sources": sources,
        "source_count": len(sources),
        "backend": backend,
    }


async def run_web_search(
    query: str,
    *,
    search_fn: SearchFn,
    llm_fn: LlmFn,
    backend: str = "local",
    max_time: int = DEFAULT_MAX_TIME,
    max_results: int = MAX_RESULTS,
) -> Dict[str, Any]:
    """One quick lookup: search → normalize → ONE short LLM call → concise cited answer.

    All I/O is injected. Every failure path returns a normal result dict with an honest
    `answer` (and the real `backend` that ran) rather than raising — an MCP tool that
    raises reads to the model as a broken tool, not as "the web didn't help".
    """
    q = (query or "").strip()
    if not q:
        return _result(query, "Error: web_search needs a non-empty query.", [], backend)

    search_s, llm_s = split_budget(max_time)

    try:
        raw = await search_fn(q, max_results, search_s)
    except asyncio.TimeoutError:
        return _result(q, f"Error: web search timed out after {search_s}s.", [], backend)
    except Exception as exc:  # noqa: BLE001 — surface, don't crash the tool
        return _result(q, f"Error: web search failed ({exc.__class__.__name__}: {exc}).", [], backend)

    results = normalize_results(raw, max_results)
    if not results:
        # Honest empty answer — and notably NO LLM call, so a dead search stays cheap.
        return _result(q, "No web results found for that query.", [], backend)

    try:
        answer = await llm_fn(build_messages(q, results), SUMMARY_MAX_TOKENS, llm_s)
    except asyncio.TimeoutError:
        # The sources are still worth returning — the search half succeeded.
        return _result(
            q,
            f"Error: the {backend} model timed out after {llm_s}s summarizing the results. "
            "The sources below were found.",
            results,
            backend,
        )
    except Exception as exc:  # noqa: BLE001
        return _result(
            q,
            f"Error: summarizing failed ({exc.__class__.__name__}: {exc}). The sources below were found.",
            results,
            backend,
        )

    cleaned = strip_reasoning(answer)
    if not cleaned:
        return _result(q, "The model returned an empty answer. The sources below were found.", results, backend)
    return _result(q, cleaned, results, backend)
