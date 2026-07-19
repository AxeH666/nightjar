# browser-use-mcp — autonomous web tasks (form-filling) for JUNE/Nightjar

A standalone MCP server exposing one high-level tool, **`run_browser_task(task)`**,
backed by [Browser Use](https://github.com/browser-use/browser-use) (MIT). Browser
Use is an *autonomous* browser agent: give it a natural-language task ("fill the
contact form at … and submit") and it drives a headless Chromium through its own
perception→action loop to completion.

This **supplements** — it does not replace — Row-Bot's low-level browser primitives
(`navigate`/`click`/`type` by accessibility ref) in the `nightjar` MCP. Keep the
primitives for stepwise/interactive control; use this for autonomous multi-step tasks.

## Model (local-first; cloud is an explicit opt-in)

Browser Use runs its own LLM loop. The resolver (`resolve_model_spec`) **defaults to the local
model** and routes to the cloud ONLY on an explicit choice — a stored BYOK key alone never sends
browser traffic off-machine (that was the NJ-14 silent-cloud leak, now closed). Order:

1. **Explicit override** — `NIGHTJAR_BROWSERUSE_BASE_URL` + `NIGHTJAR_BROWSERUSE_MODEL` (+ `_API_KEY`).
2. **`NIGHTJAR_BROWSERUSE_PROVIDER`** — set by Nightjar from the browser capability pref
   (`local` | `openai` | `openrouter`). `openrouter`/`openai` routes to that provider using
   `NIGHTJAR_BYOK_OPENROUTER` / `NIGHTJAR_BYOK_OPENAI` (models `NIGHTJAR_BROWSERUSE_OPENROUTER_MODEL`
   default `openai/gpt-4o-mini` · `NIGHTJAR_BROWSERUSE_OPENAI_MODEL` default `gpt-4o-mini`) — and
   **falls back to local if that key is absent** (the tool's result line discloses which backend ran).
3. **Local llama.cpp** — the default when nothing above selects cloud — `NIGHTJAR_LLM_ENDPOINT`
   (default the `127.0.0.1:8086` proxy), model `qwen3-4b-instruct-2507`.

`NIGHTJAR_BROWSERUSE_PREFER=local` is still honored as a legacy force-local. The local proxy
already carries a wall-clock timeout (rule 3); every run is *additionally* bounded by `timeout_s`
(asyncio wall-clock) and `max_steps` here, because the agent loop is otherwise unbounded.

## Safety

`run_browser_task` drives a real browser (high blast radius), so it is permission-gated
**`"ask"`** in `phase2-odysseus/workspace/opencode.json` (assistant mode) per rule 1 —
never auto-approved.

## Isolation

Heavy deps (openai/anthropic/google-genai/cdp-use/…) live in this component's **own
venv** (`browser-use-mcp/venv`) so they can't destabilize `phase2-mcp/venv`. Browser
Use 0.13.x drives Chromium over CDP and manages its own browser — verify with
`browser-use-mcp/venv/bin/browser-use --doctor`.

## Tests

- `test_model_resolution.py` — offline unit test of the model resolver (8/8).
- `test_run_browser_task.py` — the tool with `browser_use` mocked: result formatting,
  empty-task guard, rule-3 timeout, failure path, browser teardown (7/7).

```
browser-use-mcp/venv/bin/python test_model_resolution.py
browser-use-mcp/venv/bin/python test_run_browser_task.py
```

**Not covered here (needs real-app/hardware QA):** a live end-to-end run where the
agent actually fills a real form using the local model + a provisioned Chromium.
Attribution: `THIRD-PARTY-LICENSES/browser-use-MIT-LICENSE.txt`.
