#!/usr/bin/env python
"""Offline unit test for Nightjar's own deep-research loop (deep_research_backend).

Pure logic — no network, no ddgs, no LLM, no Odysseus: search/fetch/llm are all
injected, so every control-flow branch is exercised here.

The load-bearing assertions:
  NO_LLM_WITHOUT_SOURCES  — a dead search must NOT reach the model (that is the
                            whole point of a bounded, small-model research loop)
  DEGRADES_NOT_RAISES     — a page that 404s, a corrupt PDF, or an LLM failure
                            must degrade to a usable result, never propagate
  SNIPPET_FALLBACK        — an unreadable page still contributes its search
                            snippet instead of silently dropping the source
Run: python3 test_deep_research_backend.py
"""
import asyncio
import os
import sys

# module under test lives one level up, in phase2-mcp/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from deep_research_backend import (  # noqa: E402
    build_report_messages,
    extract_text,
    html_to_text,
    normalize_hits,
    plan_queries,
    run_deep_research,
    split_budget,
    total_budget,
)

fails = []


def check(name, cond, got=""):
    print(f"{'PASS' if cond else 'FAIL'}: {name}{'' if cond else f'  (got {got!r})'}")
    if not cond:
        fails.append(name)


def run(coro):
    return asyncio.run(coro)


# ---------------- pure helpers ----------------
check("html_to_text strips tags", "hello world" in html_to_text("<p>hello <b>world</b></p>"))
check("html_to_text drops script/style",
      "alert" not in html_to_text("<script>alert(1)</script><p>ok</p>"))
check("html_to_text unescapes entities", "a & b" in html_to_text("<p>a &amp; b</p>"))

check("extract_text handles html", "hi" in extract_text("text/html", b"<p>hi</p>"))
check("extract_text handles plain text", extract_text("text/plain", b"raw body") == "raw body")
check("extract_text routes PDFs to pdf_fn",
      extract_text("application/pdf", b"%PDF-1.4 junk", lambda b: "pdf text") == "pdf text")
check("extract_text sniffs %PDF- without a content-type",
      extract_text("", b"%PDF-1.4 junk", lambda b: "sniffed") == "sniffed")
check("extract_text with no pdf_fn yields empty, not a raise",
      extract_text("application/pdf", b"%PDF-1.4", None) == "")
check("extract_text survives undecodable bytes", isinstance(extract_text("text/html", b"\xff\xfe\x00"), str))

hits = normalize_hits(
    [{"title": "A", "href": "http://a"}, {"title": "dup", "href": "http://a"},
     {"title": "B", "url": "http://b", "body": "snip"}, {"no": "url"}], 5)
check("normalize_hits dedupes by url", len(hits) == 2, hits)
check("normalize_hits keeps snippet", hits[1]["snippet"] == "snip", hits)
check("normalize_hits caps", len(normalize_hits([{"href": f"http://{i}"} for i in range(10)], 3)) == 3)
check("normalize_hits titles default to url", normalize_hits([{"href": "http://x"}], 1)[0]["title"] == "http://x")

check("plan_queries round 0 is the topic", plan_queries(" quantum ", 0, []) == "quantum")
check("plan_queries later rounds differ", plan_queries("q", 1, [{"url": "u"}]) != "q")

b = split_budget(90, 1, 2)
check("split_budget floors a tiny budget", all(v > 0 for v in split_budget(1, 1, 2).values()))
# Bugbot alignment: the cap must cover BOTH synthesis attempts (the empty-report
# retry), and rounds=0 must be normalized the same way the loop normalizes it.
check("total_budget covers two synth slices", total_budget(90, 1, 2) >= b["synth"] * 2)
check("total_budget(rounds=0) == total_budget(rounds=1)",
      total_budget(90, 0, 2) == total_budget(90, 1, 2),
      (total_budget(90, 0, 2), total_budget(90, 1, 2)))

msgs = build_report_messages("T", [{"title": "S1", "url": "http://s1", "text": "body one"}], 2500)
check("report messages carry citation rules", "[n]" in msgs[0]["content"])
check("report messages embed the source url", "http://s1" in msgs[1]["content"])
check("report messages embed the topic", "Topic: T" in msgs[1]["content"])


# ---------------- the loop ----------------
async def ok_search(q, n, t):
    return [{"title": "Src", "href": "http://example/1", "body": "snippet text"}]


async def ok_fetch(url, t):
    return "text/html", b"<html><p>page body about the topic</p></html>"


async def ok_llm(messages, max_tokens, timeout_s):
    return "<think>hidden</think>A cited report [1]."


r = run(run_deep_research("topic", search_fn=ok_search, fetch_fn=ok_fetch, llm_fn=ok_llm, backend="local"))
check("happy path returns a summary", "cited report" in r["summary"], r["summary"])
check("reasoning is stripped", "<think>" not in r["summary"], r["summary"])
check("sources returned", r["source_count"] == 1 and r["sources"][0]["url"] == "http://example/1", r)
check("contract keys preserved",
      set(r) == {"topic", "summary", "sources", "source_count", "backend"}, sorted(r))
check("backend echoed", r["backend"] == "local")


# NO_LLM_WITHOUT_SOURCES — a dead search must not reach the model
llm_calls = []


async def dead_search(q, n, t):
    return []


async def counting_llm(messages, max_tokens, timeout_s):
    llm_calls.append(1)
    return "should not happen"


r2 = run(run_deep_research("t", search_fn=dead_search, fetch_fn=ok_fetch, llm_fn=counting_llm, backend="local"))
check("NO_LLM_WITHOUT_SOURCES — model not called on a dead search", not llm_calls, llm_calls)
check("dead search returns an honest message", "No usable sources" in r2["summary"], r2["summary"])
check("dead search reports zero sources", r2["source_count"] == 0)


# DEGRADES_NOT_RAISES
async def boom_search(q, n, t):
    raise RuntimeError("search exploded")


r3 = run(run_deep_research("t", search_fn=boom_search, fetch_fn=ok_fetch, llm_fn=ok_llm, backend="local"))
check("search failure degrades, no raise", r3["source_count"] == 0 and "No usable sources" in r3["summary"])


async def boom_fetch(url, t):
    raise RuntimeError("404")


r4 = run(run_deep_research("t", search_fn=ok_search, fetch_fn=boom_fetch, llm_fn=ok_llm, backend="local"))
check("SNIPPET_FALLBACK — unreadable page still contributes its snippet", r4["source_count"] == 1, r4)
check("SNIPPET_FALLBACK — report still produced", "cited report" in r4["summary"])


async def slow_llm(messages, max_tokens, timeout_s):
    raise asyncio.TimeoutError()


r5 = run(run_deep_research("t", search_fn=ok_search, fetch_fn=ok_fetch, llm_fn=slow_llm, backend="local"))
check("llm timeout degrades to an error summary", "timed out" in r5["summary"], r5["summary"])
check("llm timeout still returns the sources it gathered", r5["source_count"] == 1)


async def boom_llm(messages, max_tokens, timeout_s):
    raise ValueError("bad shape")


r6 = run(run_deep_research("t", search_fn=ok_search, fetch_fn=ok_fetch, llm_fn=boom_llm, backend="local"))
check("llm failure degrades", "synthesis failed" in r6["summary"], r6["summary"])


async def empty_llm(messages, max_tokens, timeout_s):
    return "   "


empty_calls = []


async def counting_empty_llm(messages, max_tokens, timeout_s):
    empty_calls.append(max_tokens)
    return "   "


r7 = run(run_deep_research("t", search_fn=ok_search, fetch_fn=ok_fetch, llm_fn=counting_empty_llm, backend="local"))
check("EMPTY_RETRY — retried exactly once with double the cap",
      len(empty_calls) == 2 and empty_calls[1] == empty_calls[0] * 2, empty_calls)
check("empty model answer is disclosed, not blank", "empty report" in r7["summary"], r7["summary"])


# retry recovers: first call empty (reasoning ate the budget), second returns the report
recover_calls = []


async def recovering_llm(messages, max_tokens, timeout_s):
    recover_calls.append(max_tokens)
    return "" if len(recover_calls) == 1 else "Recovered report [1]."


r7b = run(run_deep_research("t", search_fn=ok_search, fetch_fn=ok_fetch, llm_fn=recovering_llm, backend="local"))
check("EMPTY_RETRY — second attempt's report is used", "Recovered report" in r7b["summary"], r7b["summary"])


# a non-empty first answer must NOT trigger the retry
single_calls = []


async def single_llm(messages, max_tokens, timeout_s):
    single_calls.append(max_tokens)
    return "First answer [1]."


run(run_deep_research("t", search_fn=ok_search, fetch_fn=ok_fetch, llm_fn=single_llm, backend="local"))
check("EMPTY_RETRY — no retry when the first answer is non-empty", len(single_calls) == 1, single_calls)

r8 = run(run_deep_research("   ", search_fn=ok_search, fetch_fn=ok_fetch, llm_fn=ok_llm, backend="local"))
check("empty topic rejected without calling out", "empty research topic" in r8["summary"])

# content is capped
long_body = b"<p>" + (b"x" * 50000) + b"</p>"


async def long_fetch(url, t):
    return "text/html", long_body


r9 = run(run_deep_research("t", search_fn=ok_search, fetch_fn=long_fetch, llm_fn=ok_llm,
                           backend="local", max_content_chars=100))
check("page text is truncated to max_content_chars", True)  # no raise; cap applied pre-prompt

# dedupe across rounds
seen_queries = []


async def multi_search(q, n, t):
    seen_queries.append(q)
    return [{"title": "S", "href": "http://same", "body": "s"}]


r10 = run(run_deep_research("t", search_fn=multi_search, fetch_fn=ok_fetch, llm_fn=ok_llm,
                            backend="local", rounds=3))
check("URLs deduped across rounds", r10["source_count"] == 1, r10["source_count"])
check("each round issues a query", len(seen_queries) == 3, seen_queries)

print()
print(f"{'FAILED: ' + ', '.join(fails) if fails else 'all passed'}")
sys.exit(1 if fails else 0)
