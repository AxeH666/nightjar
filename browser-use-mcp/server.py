#!/usr/bin/env python
"""Browser Use MCP — autonomous web tasks (form-filling) for JUNE/Nightjar.

Exposes ONE high-level tool, `run_browser_task(task)`, backed by Browser Use
(github.com/browser-use/browser-use, MIT). Browser Use is an *autonomous* agent:
it drives a real (headless) Chromium through its own perception→action loop to
complete a natural-language task. This SUPPLEMENTS — does not replace — Row-Bot's
low-level primitives (navigate/click/type by ref) in the `nightjar` MCP.

Model wiring (local-first, BYOK-preferred-for-reliability): Browser Use runs its
own LLM loop, which is model-demanding. Resolution (see `resolve_model_spec`):
  1. Explicit override  (NIGHTJAR_BROWSERUSE_BASE_URL + _MODEL)
  2. BYOK OpenRouter    (NIGHTJAR_BYOK_OPENROUTER) — preferred for reliability
  3. BYOK OpenAI        (NIGHTJAR_BYOK_OPENAI)
  4. Local llama.cpp    (NIGHTJAR_LLM_ENDPOINT, default the 127.0.0.1:8086 proxy)
Set NIGHTJAR_BROWSERUSE_PREFER=local to force the local model even when a key exists
(pure-offline). The local proxy (8086) already carries a wall-clock timeout (rule 3);
we ALSO bound every run with our own asyncio wall-clock timeout + a max_steps cap,
because the agent loop is otherwise unbounded.

This tool is high-blast-radius (it operates a real browser), so it is permission
-gated ("ask") in opencode.json per rule 1 — never auto-approved.
"""
from __future__ import annotations

import asyncio
import os
import sys
from dataclasses import dataclass, field
from typing import Dict, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("browser-use")

# Dedicated persistent profile — kept separate from Row-Bot's ~/.row-bot profile so
# the two browser stacks don't clobber each other's cookies/sessions (see the
# "second browser stack" flag in AUDIT §10 order #8).
DATA_DIR = os.environ.get("NIGHTJAR_DATA_DIR") or os.path.join(os.path.expanduser("~"), ".nightjar")
PROFILE_DIR = os.path.join(DATA_DIR, "browseruse_profile")

# Bounds (rule 3): the agent loop is unbounded without these.
DEFAULT_MAX_STEPS = int(os.environ.get("NIGHTJAR_BROWSERUSE_MAX_STEPS", "25"))
DEFAULT_TIMEOUT_S = int(os.environ.get("NIGHTJAR_BROWSERUSE_TIMEOUT_S", "180"))

# The MCP client (opencode.json) hard-kills this subprocess at its `timeout` (300000 ms).
# If the host kills us mid-run, our teardown never runs and a headless Chromium orphans.
# So keep total work UNDER that cap: clamp the run timeout AND bound teardown, leaving
# headroom. Override via env if opencode.json's timeout changes.
MCP_CLIENT_TIMEOUT_S = int(os.environ.get("NIGHTJAR_BROWSERUSE_MCP_TIMEOUT_S", "300"))
CLOSE_TIMEOUT_S = int(os.environ.get("NIGHTJAR_BROWSERUSE_CLOSE_TIMEOUT_S", "20"))
MAX_RUN_TIMEOUT_S = max(30, MCP_CLIENT_TIMEOUT_S - CLOSE_TIMEOUT_S - 15)

# One live Chromium per persistent profile dir — concurrent runs would contend for the
# profile lock and corrupt session state. Serialize browser tasks (callers queue) so
# the persistent profile (logins/cookies) is preserved WITHOUT contention.
_run_lock = asyncio.Lock()


@dataclass
class ModelSpec:
    provider: str  # "override" | "openrouter" | "openai" | "local"
    base_url: str
    model: str
    api_key: str
    headers: Dict[str, str] = field(default_factory=dict)


def resolve_model_spec(env: Optional[Dict[str, str]] = None) -> ModelSpec:
    """Pick the LLM backend from env. Pure (no browser_use import) so it's unit-testable
    offline. Precedence: explicit override → BYOK OpenRouter → BYOK OpenAI → local
    llama.cpp. NIGHTJAR_BROWSERUSE_PREFER=local forces local even when a BYOK key exists."""
    e = os.environ if env is None else env

    base = (e.get("NIGHTJAR_BROWSERUSE_BASE_URL") or "").strip()
    model = (e.get("NIGHTJAR_BROWSERUSE_MODEL") or "").strip()
    if base and model:
        return ModelSpec("override", base, model, (e.get("NIGHTJAR_BROWSERUSE_API_KEY") or "sk-noop").strip())

    local = ModelSpec(
        "local",
        (e.get("NIGHTJAR_LLM_ENDPOINT") or "http://127.0.0.1:8086/v1").strip(),
        (e.get("NIGHTJAR_LLM_MODEL") or "qwen3-4b-instruct-2507").strip(),
        "sk-noop",
    )
    if (e.get("NIGHTJAR_BROWSERUSE_PREFER") or "byok").strip().lower() == "local":
        return local

    or_key = (e.get("NIGHTJAR_BYOK_OPENROUTER") or "").strip()
    if or_key:
        return ModelSpec(
            "openrouter",
            "https://openrouter.ai/api/v1",
            (e.get("NIGHTJAR_BROWSERUSE_OPENROUTER_MODEL") or "openai/gpt-4o-mini").strip(),
            or_key,
            {"HTTP-Referer": "https://github.com/AxeH666/nightjar", "X-Title": "Nightjar"},
        )
    oa_key = (e.get("NIGHTJAR_BYOK_OPENAI") or "").strip()
    if oa_key:
        return ModelSpec(
            "openai",
            "https://api.openai.com/v1",
            (e.get("NIGHTJAR_BROWSERUSE_OPENAI_MODEL") or "gpt-4o-mini").strip(),
            oa_key,
        )
    return local


def build_llm(spec: ModelSpec):
    """Construct a Browser Use ChatOpenAI for the spec. All three backends (local,
    OpenRouter, OpenAI) are OpenAI-compatible, so one class covers them."""
    from browser_use import ChatOpenAI

    kw = dict(model=spec.model, base_url=spec.base_url, api_key=spec.api_key)
    if spec.headers:
        kw["default_headers"] = spec.headers
    return ChatOpenAI(**kw)


@mcp.tool()
async def run_browser_task(task: str, max_steps: int = DEFAULT_MAX_STEPS, timeout_s: int = DEFAULT_TIMEOUT_S) -> str:
    """Autonomously operate a headless browser to complete a natural-language web task —
    e.g. "fill in the contact form at example.com with name X, email Y and submit".
    Returns the agent's final result text. Drives a REAL browser (high blast radius):
    approval-gated. Bounded by max_steps and a wall-clock timeout_s.
    """
    if not task or not task.strip():
        return "Error: task is required"

    spec = resolve_model_spec()
    try:
        from browser_use import Agent, BrowserProfile
    except Exception as e:  # dependency missing / import error
        return f"Error: browser-use is not available: {e}"

    try:
        llm = build_llm(spec)
    except Exception as e:
        return f"Error: could not initialize model ({spec.provider}:{spec.model}): {e}"

    # Clamp so run + teardown stay under the MCP client's kill timeout (finding: an
    # over-long timeout_s lets the host kill us mid-run, skipping teardown).
    eff_timeout = max(1, min(int(timeout_s), MAX_RUN_TIMEOUT_S))

    os.makedirs(PROFILE_DIR, exist_ok=True)
    # Serialize: one live Chromium per persistent profile dir; concurrent runs would
    # collide on the profile lock. Callers queue here.
    async with _run_lock:
        profile = BrowserProfile(headless=True, user_data_dir=PROFILE_DIR)
        agent = Agent(task=task.strip(), llm=llm, browser_profile=profile)

        error = None
        history = None
        try:
            history = await asyncio.wait_for(agent.run(max_steps=max_steps), timeout=eff_timeout)
        except asyncio.TimeoutError:
            error = f"Error: browser task timed out after {eff_timeout}s (model={spec.provider}:{spec.model})"
        except Exception as e:
            error = f"Error: browser task failed: {e}"

        # Always tear down the browser — but BOUND it (a hung CDP/browser shutdown must
        # not run past the MCP cap) and SURFACE failures rather than swallow them
        # silently (a Chromium/profile lock may linger; the caller should know).
        warn = ""
        try:
            await asyncio.wait_for(agent.close(), timeout=CLOSE_TIMEOUT_S)
        except Exception as ce:
            warn = (f"  [warning: browser did not shut down cleanly ({ce!r}); "
                    f"a headless Chromium may still be running]")
            print(f"[browser-use] teardown failed/timed out: {ce!r}", file=sys.stderr, flush=True)

    if error is not None:
        return error + warn
    result = history.final_result() if history is not None else None
    done = history.is_done() if history is not None else False
    return f"{result or '(no final result returned)'}\n\n[model: {spec.provider}:{spec.model} · done={done}]{warn}"


if __name__ == "__main__":
    mcp.run()
