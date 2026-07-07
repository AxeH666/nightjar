#!/usr/bin/env python
# In-process test of the run_browser_task MCP tool with browser_use MOCKED — no real
# browser, model, or network. Proves: result formatting, empty-task guard, the rule-3
# wall-clock timeout, the failure path, and that the browser is always torn down
# (agent.close) incl. on timeout. Run: browser-use-mcp/venv/bin/python test_run_browser_task.py
import asyncio
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Force the local model so the [model: …] tag is deterministic, regardless of any
# BYOK vars present in the ambient env.
for k in ("NIGHTJAR_BYOK_OPENROUTER", "NIGHTJAR_BYOK_OPENAI",
          "NIGHTJAR_BROWSERUSE_BASE_URL", "NIGHTJAR_BROWSERUSE_MODEL"):
    os.environ.pop(k, None)
os.environ["NIGHTJAR_BROWSERUSE_PREFER"] = "local"

import server  # imports FastMCP only; browser_use is imported lazily inside the tool

# ── Build a fake `browser_use` module and inject it so the tool's lazy imports use it ──
fake = types.ModuleType("browser_use")
fake.MODE = "ok"           # "ok" | "slow" | "raise"
fake.CLOSED = []           # records agent.close() calls


class _History:
    def final_result(self):
        return "Filled and submitted the contact form"

    def is_done(self):
        return True


class _Agent:
    def __init__(self, task=None, llm=None, browser_profile=None, **kw):
        self.task = task

    async def run(self, max_steps=25, **kw):
        if fake.MODE == "slow":
            await asyncio.sleep(10)  # exceed the test timeout
        if fake.MODE == "raise":
            raise RuntimeError("boom")
        return _History()

    async def close(self):
        fake.CLOSED.append(1)


class _BrowserProfile:
    def __init__(self, headless=True, user_data_dir=None, **kw):
        self.headless = headless


class _ChatOpenAI:
    def __init__(self, model=None, base_url=None, api_key=None, default_headers=None, **kw):
        self.model, self.base_url = model, base_url


fake.Agent = _Agent
fake.BrowserProfile = _BrowserProfile
fake.ChatOpenAI = _ChatOpenAI
sys.modules["browser_use"] = fake

fails = []


def check(name, cond, got=""):
    print(f"{'PASS' if cond else 'FAIL'}: {name}{'' if cond else f'  (got {got!r})'}")
    if not cond:
        fails.append(name)


# 1) empty task guard (no browser touched)
r = asyncio.run(server.run_browser_task("   "))
check("empty task → error", r == "Error: task is required", r)

# 2) happy path → final result + deterministic local model tag; browser closed
fake.MODE = "ok"; fake.CLOSED.clear()
r = asyncio.run(server.run_browser_task("fill the form at example.com"))
check("happy path returns final result", "Filled and submitted the contact form" in r, r)
check("happy path tags local model", "[model: local:qwen3-4b-instruct-2507 · done=True]" in r, r)
check("happy path closed the browser", fake.CLOSED == [1], fake.CLOSED)

# 3) rule-3 wall-clock timeout → error, browser still torn down
fake.MODE = "slow"; fake.CLOSED.clear()
r = asyncio.run(server.run_browser_task("hang forever", timeout_s=1))
check("timeout → timeout error", r.startswith("Error: browser task timed out after 1s"), r)
check("timeout still closed the browser", fake.CLOSED == [1], fake.CLOSED)

# 4) agent failure → clean error, browser torn down
fake.MODE = "raise"; fake.CLOSED.clear()
r = asyncio.run(server.run_browser_task("do something"))
check("failure → failure error", r.startswith("Error: browser task failed: boom"), r)
check("failure still closed the browser", fake.CLOSED == [1], fake.CLOSED)

print(f"\n==== run_browser_task: {7 - len(fails)}/7 passed ====")
sys.exit(1 if fails else 0)
