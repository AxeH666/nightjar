#!/usr/bin/env python
# Offline unit test for the lightweight web_search backend (web_search_backend).
# Pure logic — no network, no ddgs, no LLM, no DeepResearcher: both I/O steps are
# injected, so every control-flow branch (empty query, dead search, zero results,
# search failure, LLM timeout, <think> leakage) is exercised here.
#
# The load-bearing assertion is NO_LLM_ON_ZERO_RESULTS: a dead search must NOT reach
# the model. That is the whole point of the tool — a quick lookup that stays quick.
# Run: python3 test_web_search_backend.py
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from research_backend import RESEARCH_PROVIDERS  # noqa: E402 — the cloud provider ids we must not break
from web_search_backend import (  # noqa: E402
    LLM_MIN,
    SEARCH_MIN,
    SNIPPET_CHARS,
    build_messages,
    normalize_results,
    payload_extras,
    run_web_search,
    split_budget,
    strip_reasoning,
)

fails = []
total = 0


def check(name, cond, got=""):
    global total
    total += 1
    print(f"{'PASS' if cond else 'FAIL'}: {name}{'' if cond else f'  (got {got})'}")
    if not cond:
        fails.append(name)


ROWS = [
    {"title": "OCCT", "href": "https://a.example/1", "body": "Open CASCADE is a CAD kernel."},
    {"title": "Dupe", "href": "https://a.example/1", "body": "same url, must be dropped"},
    {"title": "No url", "href": "", "body": "unciteable, must be dropped"},
    {"title": "Second", "href": "https://b.example/2", "body": "x" * (SNIPPET_CHARS + 200)},
]


# ---------- normalize_results ----------
n = normalize_results(ROWS)
check("normalize maps ddgs href/body → url/snippet", n[0]["url"] == "https://a.example/1" and n[0]["snippet"].startswith("Open CASCADE"), n[0])
check("normalize de-dupes by url", len(n) == 2, [r["url"] for r in n])
check("normalize drops rows with no url", all(r["url"] for r in n), n)
check("normalize truncates the snippet", len(n[1]["snippet"]) == SNIPPET_CHARS, len(n[1]["snippet"]))
check("normalize honors max_results", len(normalize_results(ROWS, max_results=1)) == 1)
check("normalize survives empty input", normalize_results([]) == [] and normalize_results(None) == [])
check("normalize falls back to url as title", normalize_results([{"href": "https://c.example", "body": "b"}])[0]["title"] == "https://c.example")


# ---------- split_budget ----------
s, l = split_budget(25)
check("split_budget(25) sums to the budget", s + l == 25, (s, l))
check("split_budget respects the search cap", s <= 10, s)
s0, l0 = split_budget(0)
check("split_budget floors a zero budget (never hands out a 0s timeout)", s0 >= SEARCH_MIN and l0 >= LLM_MIN, (s0, l0))


# ---------- build_messages ----------
msgs = build_messages("what is OCCT", n)
check("build_messages is system+user", [m["role"] for m in msgs] == ["system", "user"], [m["role"] for m in msgs])
check("build_messages carries the query", "what is OCCT" in msgs[1]["content"])
check("build_messages numbers the sources with urls", "[1]" in msgs[1]["content"] and "https://a.example/1" in msgs[1]["content"])
check("system prompt forbids deep research", "not a report" in msgs[0]["content"].lower() or "quick lookup" in msgs[0]["content"].lower())


# ---------- strip_reasoning ----------
check("strip_reasoning drops <think> blocks", strip_reasoning("<think>hmm</think>Answer.") == "Answer.")
check("strip_reasoning is multiline/case tolerant", strip_reasoning("<THINK>a\nb</THINK> Ans") == "Ans")
check("strip_reasoning leaves clean text alone", strip_reasoning("Just an answer.") == "Just an answer.")


# ---------- payload_extras (the local-only thinking switch) ----------
# Measured: qwen3:8b answered the same question in 25.3s with thinking on vs 10.2s off —
# the reasoning pass alone blew the summarize budget. But cloud providers 400 on unknown
# request params, so this MUST stay local-only. That gate is the load-bearing assertion.
check("local disables the <think> pass", payload_extras("local") == {"chat_template_kwargs": {"enable_thinking": False}}, payload_extras("local"))
check(
    "NO_EXTRAS_ON_CLOUD — no cloud provider is ever sent the local-only param (they 400)",
    all(payload_extras(p) == {} for p in RESEARCH_PROVIDERS),
    {p: payload_extras(p) for p in RESEARCH_PROVIDERS if payload_extras(p)},
)
check("an unknown backend gets no extras (safe default)", payload_extras("something-new") == {})


# ---------- run_web_search (injected I/O) ----------
def fake_search(rows, *, raises=None, record=None):
    async def _f(query, max_results, timeout_s):
        if record is not None:
            record["search"] = record.get("search", 0) + 1
        if raises:
            raise raises
        return rows
    return _f


def fake_llm(answer="An answer.", *, raises=None, record=None):
    async def _f(messages, max_tokens, timeout_s):
        if record is not None:
            record["llm"] = record.get("llm", 0) + 1
            record["max_tokens"] = max_tokens
        if raises:
            raise raises
        return answer
    return _f


rec = {}
r = asyncio.run(run_web_search("q", search_fn=fake_search(ROWS, record=rec), llm_fn=fake_llm(record=rec), backend="local"))
check("happy path returns the answer", r["answer"] == "An answer.", r["answer"])
check("happy path returns de-duped sources", r["source_count"] == 2, r["source_count"])
check("happy path reports the real backend", r["backend"] == "local", r["backend"])
check("happy path caps generation tokens (rule 3)", rec.get("max_tokens") == 400, rec.get("max_tokens"))

rec = {}
r = asyncio.run(run_web_search("   ", search_fn=fake_search(ROWS, record=rec), llm_fn=fake_llm(record=rec)))
check("empty query errors without searching", "non-empty query" in r["answer"] and "search" not in rec, (r["answer"], rec))

# THE load-bearing one: a dead search must not reach the model.
rec = {}
r = asyncio.run(run_web_search("q", search_fn=fake_search([], record=rec), llm_fn=fake_llm(record=rec)))
check("NO_LLM_ON_ZERO_RESULTS — zero results never calls the LLM", "llm" not in rec, rec)
check("zero results answers honestly", "No web results" in r["answer"], r["answer"])

rec = {}
r = asyncio.run(run_web_search("q", search_fn=fake_search(None, raises=RuntimeError("ddgs down"), record=rec), llm_fn=fake_llm(record=rec)))
check("search failure is surfaced, not raised", r["answer"].startswith("Error: web search failed") and "ddgs down" in r["answer"], r["answer"])
check("search failure never calls the LLM", "llm" not in rec, rec)

r = asyncio.run(run_web_search("q", search_fn=fake_search(ROWS), llm_fn=fake_llm(raises=asyncio.TimeoutError()), backend="groq"))
check("LLM timeout is surfaced with the real backend", "timed out" in r["answer"] and "groq" in r["answer"], r["answer"])
check("LLM timeout still returns the sources it found", r["source_count"] == 2, r["source_count"])

r = asyncio.run(run_web_search("q", search_fn=fake_search(ROWS), llm_fn=fake_llm("<think>reasoning</think>Clean.")))
check("run_web_search strips leaked reasoning", r["answer"] == "Clean.", r["answer"])

r = asyncio.run(run_web_search("q", search_fn=fake_search(ROWS), llm_fn=fake_llm("   ")))
check("empty model answer is disclosed, not returned blank", "empty answer" in r["answer"], r["answer"])


print(f"\n{total - len(fails)}/{total} passed")
if fails:
    print("FAILED: " + ", ".join(fails))
    sys.exit(1)
