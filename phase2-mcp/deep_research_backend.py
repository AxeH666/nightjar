"""Nightjar's own deep-research loop. Pure orchestration — all I/O injected.

Odysseus removal, PR F. Odysseus's `src/deep_research.py` is AGPL and cannot be
lifted. Odysseus's own ACKNOWLEDGMENTS.md credits that pipeline as adapted from
**Tongyi DeepResearch** (Alibaba-NLP / Tongyi Lab, Apache-2.0) — the search →
fetch → extract → synthesize shape below follows that well-known pattern and is
written from scratch here. No Odysseus code is copied.

The target is deliberately modest, because the previous server had already tuned
it down to something a local 4B can finish: 1 round, 2 URLs, a 2500-char
extraction window, a ~700-token report. Those knobs keep their env-var names, so
an existing install behaves the same.

Everything here is dependency-free and synchronous-testable: `search_fn`,
`fetch_fn` and `llm_fn` are injected, so the whole control flow (dead search, a
page that 404s, a PDF, an over-long page, an LLM timeout, zero usable sources)
is exercised offline in tests/test_deep_research_backend.py.

Rule 3 note: every stage gets a slice of the caller's budget, and the caller wraps
the whole thing in a hard asyncio.wait_for. A single fetch or generation can never
run unbounded.
"""
from __future__ import annotations

import asyncio
import re
from typing import Any, Awaitable, Callable, Dict, List, Optional, Sequence

from web_search_backend import payload_extras, strip_reasoning  # shared, already unit-tested

# Defaults mirror the tuned values the Odysseus wrapper passed (deep_research_server.py),
# so behaviour is unchanged for an existing install.
DEFAULT_ROUNDS = 1
DEFAULT_URLS_PER_ROUND = 2
DEFAULT_CONTENT_CHARS = 2500
DEFAULT_REPORT_TOKENS = 700
DEFAULT_MAX_TIME = 90

# A page we cannot turn into text is skipped, not fatal.
_TAG_RE = re.compile(r"<(script|style)\b.*?</\1>", re.DOTALL | re.IGNORECASE)
_HTML_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t\r\f\v]+")
_NL_RE = re.compile(r"\n{3,}")

SearchFn = Callable[[str, int, float], Awaitable[Sequence[Dict[str, Any]]]]
FetchFn = Callable[[str, float], Awaitable[tuple]]  # -> (content_type, body: bytes)
LlmFn = Callable[[List[Dict[str, str]], int, float], Awaitable[str]]
PdfFn = Callable[[bytes], str]


def html_to_text(html: str) -> str:
    """Crude but dependency-free HTML → text. Good enough to feed a summarizer."""
    txt = _TAG_RE.sub(" ", html)
    txt = _HTML_RE.sub(" ", txt)
    txt = (txt.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<")
              .replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'"))
    txt = _WS_RE.sub(" ", txt)
    return _NL_RE.sub("\n\n", txt).strip()


def extract_text(content_type: str, body: bytes, pdf_fn: Optional[PdfFn] = None) -> str:
    """Turn a fetched body into text. PDFs go through pdf_fn (pypdf, BSD — never
    PyMuPDF, which is AGPL). Anything undecodable yields "" and is skipped."""
    ct = (content_type or "").lower()
    try:
        if "pdf" in ct or body[:5] == b"%PDF-":
            return pdf_fn(body).strip() if pdf_fn else ""
        text = body.decode("utf-8", errors="replace")
        return html_to_text(text) if ("html" in ct or "<" in text[:200]) else text.strip()
    except Exception:  # noqa: BLE001 — a bad page must not kill the run
        return ""


def split_budget(max_time: int, rounds: int, urls: int) -> Dict[str, float]:
    """Slice the wall-clock budget across search / fetch / synthesis.

    Floors small budgets so a tiny max_time doesn't starve a stage into instant
    failure (the same lesson web_search_backend records: a raw cap shorter than
    the stages are allowed to run kills work that was about to succeed).
    """
    total = max(int(max_time), 30)
    search = max(8.0, total * 0.15 / max(rounds, 1))
    fetch = max(6.0, total * 0.45 / max(rounds * max(urls, 1), 1))
    synth = max(20.0, total * 0.40)
    return {"search": search, "fetch": fetch, "synth": synth}


def total_budget(max_time: int, rounds: int = DEFAULT_ROUNDS, urls: int = DEFAULT_URLS_PER_ROUND) -> int:
    """Ceiling the stages may actually consume — what the caller's hard cap derives from.

    Two Bugbot-caught alignment rules with run_deep_research:
      * rounds is normalized with the SAME max(rounds, 1) the loop uses, so
        NIGHTJAR_RESEARCH_ROUNDS=0 doesn't produce a cap that undercounts the one
        round that still runs;
      * synthesis is counted TWICE, because the empty-report retry can run a second
        full-budget synthesis call — a single-slice cap could fire mid-retry and
        turn the recovery into a timeout.
    """
    r = max(rounds, 1)
    b = split_budget(max_time, r, urls)
    return int(b["search"] * r + b["fetch"] * r * max(urls, 1) + b["synth"] * 2)


def plan_queries(topic: str, round_index: int, gathered: Sequence[Dict[str, str]]) -> str:
    """The query for a given round. Round 0 is the topic; later rounds bias toward
    detail the first pass is likely to have missed. Deliberately rule-based — an
    extra LLM call per round is exactly the cost the tuning was trying to avoid."""
    t = topic.strip()
    if round_index == 0 or not gathered:
        return t
    return f"{t} details analysis {round_index + 1}"


def normalize_hits(rows: Sequence[Dict[str, Any]], limit: int) -> List[Dict[str, str]]:
    """Search rows → [{title, url, snippet}], deduped by URL, capped."""
    out: List[Dict[str, str]] = []
    seen = set()
    for r in rows or []:
        url = (r.get("href") or r.get("url") or r.get("link") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        out.append({
            "title": (r.get("title") or "").strip() or url,
            "url": url,
            "snippet": (r.get("body") or r.get("snippet") or "").strip(),
        })
        if len(out) >= limit:
            break
    return out


def build_report_messages(topic: str, sources: Sequence[Dict[str, str]], max_chars: int) -> List[Dict[str, str]]:
    """One synthesis call over the gathered sources, with explicit citation rules."""
    blocks = []
    for i, s in enumerate(sources, 1):
        body = (s.get("text") or s.get("snippet") or "")[:max_chars]
        blocks.append(f"[{i}] {s['title']}\nURL: {s['url']}\n{body}")
    corpus = "\n\n".join(blocks)
    # "Write the report directly, do not deliberate" is a latency AND correctness
    # control: a hybrid-reasoning local model's think pass counts against max_tokens
    # (web_search_backend records the measurement), so invited deliberation can eat
    # the entire report budget and return empty content.
    return [
        {
            "role": "system",
            "content": (
                "You are a research assistant. Write a concise, factual report from the "
                "numbered sources provided. Cite claims with [n] matching the source "
                "numbers. Do NOT invent sources or facts that are not in the material. "
                "If the sources are thin or conflicting, say so plainly. Write the report "
                "directly and immediately — do not deliberate at length first."
            ),
        },
        {
            "role": "user",
            "content": f"Topic: {topic}\n\nSources:\n{corpus}\n\nWrite the report now.",
        },
    ]


def _result(topic: str, summary: str, sources: Sequence[Dict[str, str]], backend: str) -> Dict[str, Any]:
    """The tool's return contract — unchanged from the Odysseus wrapper, so nothing
    downstream (the research agent prompt, the UI) has to change."""
    cited = [{"title": s["title"], "url": s["url"]} for s in sources]
    return {
        "topic": topic,
        "summary": summary,
        "sources": cited,
        "source_count": len(cited),
        "backend": backend,
    }


async def run_deep_research(
    topic: str,
    *,
    search_fn: SearchFn,
    fetch_fn: FetchFn,
    llm_fn: LlmFn,
    backend: str,
    pdf_fn: Optional[PdfFn] = None,
    max_time: int = DEFAULT_MAX_TIME,
    rounds: int = DEFAULT_ROUNDS,
    urls_per_round: int = DEFAULT_URLS_PER_ROUND,
    max_content_chars: int = DEFAULT_CONTENT_CHARS,
    max_report_tokens: int = DEFAULT_REPORT_TOKENS,
) -> Dict[str, Any]:
    """search → fetch → extract → synthesize. Never raises for a content failure."""
    topic = (topic or "").strip()
    if not topic:
        return _result(topic, "Error: empty research topic.", [], backend)

    budget = split_budget(max_time, rounds, urls_per_round)
    gathered: List[Dict[str, str]] = []
    seen_urls: set[str] = set()

    for rnd in range(max(rounds, 1)):
        query = plan_queries(topic, rnd, gathered)
        try:
            rows = await search_fn(query, urls_per_round * 2, budget["search"])
        except (asyncio.TimeoutError, Exception):  # noqa: B014,BLE001 — a dead search is not fatal
            rows = []
        hits = [h for h in normalize_hits(rows, urls_per_round * 2) if h["url"] not in seen_urls]
        if not hits:
            continue

        for hit in hits[:urls_per_round]:
            seen_urls.add(hit["url"])
            text = ""
            try:
                ctype, body = await fetch_fn(hit["url"], budget["fetch"])
                text = extract_text(ctype, body, pdf_fn)
            except (asyncio.TimeoutError, Exception):  # noqa: B014,BLE001
                text = ""
            # A page we could not read still contributes its search snippet rather
            # than dropping the source entirely.
            hit["text"] = (text or hit.get("snippet", ""))[:max_content_chars]
            if hit["text"]:
                gathered.append(hit)

    if not gathered:
        return _result(
            topic,
            "No usable sources were found for that topic (the search returned nothing, "
            "or every page failed to fetch).",
            [],
            backend,
        )

    messages = build_report_messages(topic, gathered, max_content_chars)
    summary = ""
    # EMPTY_RETRY: on a hybrid-reasoning local model the think pass counts against
    # max_tokens even with enable_thinking:false (measured — see web_search_backend's
    # SUMMARY_MAX_TOKENS note), so the first attempt can spend the whole report budget
    # reasoning and return empty content. Retry EXACTLY ONCE with double the cap —
    # bounded (no loop), still inside the synth wall-clock slice, and disclosed if it
    # also fails. Reproduced live: Ollama qwen3:1.7b + 2 real sources -> empty first
    # attempt; the doubled retry produced the report.
    for attempt, tokens in enumerate((max_report_tokens, max_report_tokens * 2)):
        try:
            raw = await llm_fn(messages, tokens, budget["synth"])
        except asyncio.TimeoutError:
            return _result(topic, f"Error: report synthesis timed out (backend={backend}).", gathered, backend)
        except Exception as exc:  # noqa: BLE001
            return _result(topic, f"Error: report synthesis failed ({type(exc).__name__}).", gathered, backend)
        summary = strip_reasoning(raw or "").strip()
        if summary:
            break

    if not summary:
        summary = "(the model returned an empty report — the sources are listed below)"
    return _result(topic, summary, gathered, backend)
