# browser-use-mcp — autonomous web tasks (form-filling) for JUNE/Nightjar

A standalone MCP server exposing one high-level tool, **`run_browser_task(task)`**,
backed by [Browser Use](https://github.com/browser-use/browser-use) (MIT). Browser
Use is an *autonomous* browser agent: give it a natural-language task ("fill the
contact form at … and submit") and it drives a headless Chromium through its own
perception→action loop to completion.

This **supplements** — it does not replace — Row-Bot's low-level browser primitives
(`navigate`/`click`/`type` by accessibility ref) in the `nightjar` MCP. Keep the
primitives for stepwise/interactive control; use this for autonomous multi-step tasks.

## Model (local-first, BYOK-preferred-for-reliability)

Browser Use runs its own LLM loop, which is model-demanding, so the resolver
(`resolve_model_spec`) prefers a cloud key when one is present, falling back to the
always-available local model:

1. **Explicit override** — `NIGHTJAR_BROWSERUSE_BASE_URL` + `NIGHTJAR_BROWSERUSE_MODEL` (+ `_API_KEY`)
2. **BYOK OpenRouter** — `NIGHTJAR_BYOK_OPENROUTER` (model `NIGHTJAR_BROWSERUSE_OPENROUTER_MODEL`, default `openai/gpt-4o-mini`)
3. **BYOK OpenAI** — `NIGHTJAR_BYOK_OPENAI` (model `NIGHTJAR_BROWSERUSE_OPENAI_MODEL`, default `gpt-4o-mini`)
4. **Local llama.cpp** — `NIGHTJAR_LLM_ENDPOINT` (default the `127.0.0.1:8086` proxy), model `qwen3-4b-instruct-2507`

Set **`NIGHTJAR_BROWSERUSE_PREFER=local`** to force the local model even when a BYOK
key exists (pure-offline). The local proxy already carries a wall-clock timeout
(rule 3); every run is *additionally* bounded by `timeout_s` (asyncio wall-clock) and
`max_steps` here, because the agent loop is otherwise unbounded.

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
