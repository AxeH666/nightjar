#!/usr/bin/env python
# In-process test of the run_browser_task MCP tool with browser_use MOCKED — no real
# browser, model, or network. Proves: result formatting, empty-task guard, the rule-3
# wall-clock timeout, the failure path, bounded+surfaced browser teardown, and that
# concurrent calls are serialized (one Chromium per persistent profile).
# Run: browser-use-mcp/venv/bin/python test_run_browser_task.py
import asyncio
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Force the local model (deterministic [model: …] tag) and a short close bound so the
# slow-teardown case times out fast. Must be set BEFORE importing server.
for k in ("NIGHTJAR_BYOK_OPENROUTER", "NIGHTJAR_BYOK_OPENAI",
          "NIGHTJAR_BROWSERUSE_BASE_URL", "NIGHTJAR_BROWSERUSE_MODEL"):
    os.environ.pop(k, None)
os.environ["NIGHTJAR_BROWSERUSE_PREFER"] = "local"
os.environ["NIGHTJAR_BROWSERUSE_CLOSE_TIMEOUT_S"] = "1"

import server  # imports FastMCP only; browser_use is imported lazily inside the tool

# ── Fake `browser_use` module injected so the tool's lazy imports use it ──
fake = types.ModuleType("browser_use")
fake.MODE = "ok"          # run(): "ok" | "slow" | "raise"
fake.CLOSE_MODE = "ok"    # close(): "ok" | "raise" | "slow"
fake.CLOSED = []
fake.active = 0
fake.max_active = 0       # peak concurrent Agent.run — must stay 1 (serialized)


class _History:
    def final_result(self):
        return "Filled and submitted the contact form"

    def is_done(self):
        return True


class _Agent:
    def __init__(self, task=None, llm=None, browser_profile=None, **kw):
        self.task = task

    async def run(self, max_steps=25, **kw):
        fake.active += 1
        fake.max_active = max(fake.max_active, fake.active)
        try:
            if fake.MODE == "slow":
                await asyncio.sleep(10)
            if fake.MODE == "raise":
                raise RuntimeError("boom")
            await asyncio.sleep(0.05)  # let a second concurrent call overlap if unserialized
            return _History()
        finally:
            fake.active -= 1

    async def close(self):
        if fake.CLOSE_MODE == "raise":
            raise RuntimeError("close boom")
        if fake.CLOSE_MODE == "slow":
            await asyncio.sleep(10)  # exceeds CLOSE_TIMEOUT_S=1 → bounded → warned
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


def reset(mode="ok", close_mode="ok"):
    fake.MODE, fake.CLOSE_MODE = mode, close_mode
    fake.CLOSED.clear()
    fake.active = fake.max_active = 0


# 1) empty task guard (no browser touched)
r = asyncio.run(server.run_browser_task("   "))
check("empty task → error", r == "Error: task is required", r)

# 2) happy path → final result + deterministic local model tag; browser closed; no warn
reset("ok", "ok")
r = asyncio.run(server.run_browser_task("fill the form at example.com"))
check("happy path returns final result", "Filled and submitted the contact form" in r, r)
check("happy path tags local model", "[model: local:qwen3-4b-instruct-2507 · done=True]" in r, r)
check("happy path closed the browser", fake.CLOSED == [1], fake.CLOSED)
check("happy path no teardown warning", "warning" not in r, r)

# 3) rule-3 wall-clock timeout → error, browser still torn down
reset("slow", "ok")
r = asyncio.run(server.run_browser_task("hang forever", timeout_s=1))
check("timeout → timeout error", r.startswith("Error: browser task timed out after 1s"), r)
check("timeout still closed the browser", fake.CLOSED == [1], fake.CLOSED)

# 4) agent failure → clean error, browser torn down
reset("raise", "ok")
r = asyncio.run(server.run_browser_task("do something"))
check("failure → failure error", r.startswith("Error: browser task failed: boom"), r)
check("failure still closed the browser", fake.CLOSED == [1], fake.CLOSED)

# 5) teardown raises → result still returned, but a warning is SURFACED (not swallowed)
reset("ok", "raise")
r = asyncio.run(server.run_browser_task("fill a form"))
check("teardown-raise still returns result", "Filled and submitted the contact form" in r, r)
check("teardown-raise surfaces warning", "did not shut down cleanly" in r, r)

# 6) teardown hangs → bounded by CLOSE_TIMEOUT_S(=1), warning surfaced (doesn't hang forever)
reset("ok", "slow")
r = asyncio.run(asyncio.wait_for(server.run_browser_task("fill a form"), timeout=6))
check("teardown-slow is bounded + warned", "did not shut down cleanly" in r, r)

# 7) over-long timeout_s is clamped under the MCP cap
check("timeout clamp constant sane", 30 <= server.MAX_RUN_TIMEOUT_S < server.MCP_CLIENT_TIMEOUT_S,
      server.MAX_RUN_TIMEOUT_S)

# 8) serialization: two concurrent calls never run Agent.run simultaneously
reset("ok", "ok")


async def _two():
    await asyncio.gather(server.run_browser_task("task A"), server.run_browser_task("task B"))


asyncio.run(_two())
check("concurrent runs serialized (peak active == 1)", fake.max_active == 1, fake.max_active)

n = 12
print(f"\n==== run_browser_task: {n - len(fails)}/{n} passed ====")
sys.exit(1 if fails else 0)
