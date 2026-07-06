# Nightjar Phase 1 Report — Engine Bring-Up

Bare-loop validation: OpenCode + local Ollama models, no Row-Bot, no custom UI, no orb-ui.
Workspace: `$NIGHTJAR_ROOT/phase1-engine/` (config + a throwaway `sample/greet.py` used as the tool-calling test target).

## Result: bare loop works end-to-end

`bun run --conditions=browser src/index.ts run "..." --model ollama/<model> --auto` reliably drives OpenCode's real agent loop (`packages/opencode/src/session/processor.ts`) against a local Ollama model through the documented `@ai-sdk/openai-compatible` provider config, invoking real `read`/`edit`/`bash`/`grep` tool calls against the local filesystem — not simulated, not mocked. This confirms the audit's Phase 1 scope is achievable as described.

## Environment set up

- **Bun**: not preinstalled; installed via `curl -fsSL https://bun.sh/install | bash` → v1.3.14.
- **Ollama**: already installed and running as a system service (v0.17.7), reachable at `http://localhost:11434`.
- **Hardware discovered mid-phase (this materially changed the model decision — see below)**: laptop RTX 4050 with only **6GB VRAM**, 23GB system RAM, 8 cores. This is a hard constraint the original "Qwen3-Coder or Gemma 4" framing didn't account for.
- **OpenCode**: `bun install` at repo root (4674 packages, ~12 min first run). The published `opencode` npm binary launcher (`packages/opencode/bin/opencode`) expects a prebuilt platform binary that doesn't exist for a from-source clone — the correct entry point for a source build is `bun run --cwd packages/opencode --conditions=browser src/index.ts` (the root `package.json`'s own `dev` script). Worth knowing before anyone tries to naively run `./bin/opencode`.

## Model decision: neither of the two originally named options survived contact with hardware or reality

- **Qwen3-Coder**: only ships on Ollama at 30B-A3B minimum (~18-19GB) or 480B. Both are impractical on a 6GB-VRAM laptop — ruled out before testing, on capacity grounds alone.
- **Gemma 4 (gemma3:4b, already present locally)**: tested directly — Ollama's own API **rejects it outright**: `{"error":"registry.ollama.ai/library/gemma3:4b does not support tools"}`. This isn't a tuning problem, it's a hard capability gap. Confirms the tradeoff flagged in the original audit (§ORB-UI note on Gemma) — Gemma3 cannot drive OpenCode's tool-calling loop at all.
- Substituted **`qwen2.5-coder:7b-instruct`** first (fits VRAM, "coder"-branded, Qwen lineage known for tool-use). **This also failed** — see finding #1 below. It was not usable despite being the closest available literal reading of "Qwen3-Coder."
- Landed on **`qwen3` family** (genuine Qwen3 architecture, not 2.5), which has native, well-tested tool-calling support in Ollama. Tested both **`qwen3:1.7b`** and **`qwen3:8b`**, both built as custom 32k-context Modelfile variants (see finding #2). Final recommendation: **`qwen3:8b`** for anything that edits files; `qwen3:1.7b` only for pure read/lookup tasks. See finding #3 for why.

## Findings — tool-calling reliability (the thing we were specifically asked to stress)

### 1. `qwen2.5-coder:7b-instruct` cannot do structured tool calls at all, through any path, at any context size — disqualifying

First attempt (default ~2-4k context) produced hallucinated tool-call-shaped text instead of real tool invocations — the model would answer a plain question by emitting `{"name": "webfetch", "arguments": {...}}` as literal chat text, which OpenCode correctly did *not* parse as a tool call (so the loop just ended with garbage as the "answer").

Raised context to 32k via a custom Modelfile (`PARAMETER num_ctx 32768`) per OpenCode's own docs guidance ("if tool calls aren't working, try increasing num_ctx, start around 16k-32k") — **did not fix it**. Isolated the failure below the OpenCode/AI-SDK layer entirely by hitting Ollama directly:

- `POST /v1/chat/completions` (OpenAI-compat) with a single minimal tool schema → model responds with `content: "{\"name\": \"read\", \"arguments\": {\"filePath\": \"sample/greet.py\"}}"` and `tool_calls: null`.
- `POST /api/chat` (Ollama's **native** endpoint, bypassing the OpenAI-compat shim entirely) → **identical failure**, same bare JSON in `content`, no `tool_calls`.
- Repeated 4x — 100% failure rate, not stochastic.

Root cause: `qwen2.5-coder`'s Ollama chat template requires the model to wrap tool calls in `<tool_call>...</tool_call>` tags, which Ollama's parser looks for to populate `tool_calls`. This specific model/quantization reliably emits the bare JSON *without* the wrapping tags, so Ollama's parser never recognizes it as a tool call under any transport. This is a model-template compatibility issue, not an OpenCode bug and not fixable by context tuning.

**Implication for the plan**: don't default to "any Qwen coder-branded model" as shorthand for "good tool-calling." Verify the specific model+quant actually round-trips through Ollama's tool-call parser before standardizing on it.

### 2. `num_ctx` tuning is real and necessary — but only matters once you're on a model whose tool-calling format actually works

Confirmed via `qwen3` models: at default context, `qwen3:1.7b` and `qwen3:8b` both produced correct `tool_calls` on Ollama's native API on the first try (no tuning needed for the mechanism itself). But OpenCode's actual system prompt + full built-in tool schema (bash/edit/read/write/glob/grep/webfetch/websearch/lsp/task/question/todo/apply_patch/skill/plan — 14 tools with descriptions) is large; running qwen3 models through OpenCode's `run` command at default context produced inconsistent behavior in early trials. Built explicit 32k-context Modelfile variants (`qwen3-1.7b-32k`, `qwen3-8b-32k`, same pattern as the disqualified `qwen2.5-coder-32k`) and standardized on those for all further testing — matches OpenCode's own documented advice. Recommend baking a 32k (or higher, hardware permitting) `num_ctx` Modelfile into Nightjar's default local-model setup rather than relying on Ollama's small default.

### 3. Tool-call *format* reliability and tool-use *judgment* reliability are separate axes — model size affects the second one a lot, and this is the most important finding of the phase

With `qwen3-1.7b-32k`, real (correctly formatted, correctly parsed) tool calls were issued for every request — but the model's *judgment* about how to use them was unsafe:

- **Read-only task** (read a file, answer a question about it): worked correctly, including an unprompted self-correction from an absolute path (`/sample/greet.py`, which OpenCode correctly rejected as outside-project and then failed with "File not found" since it resolved to filesystem root) to a working relative glob pattern. Fine.
- **Edit task** ("add a one-line docstring"): the model's first `edit` call was invalid (empty `oldString`, which OpenCode's edit tool correctly rejects with a clear corrective error message: *"oldString cannot be empty... use write for an intentional full-file replacement"*). Instead of fixing the edit call, **the model called `write` with only the docstring text as the entire file content — destroying the whole script** (all the actual code was gone, replaced by the single line `Return a greeting for name.`). This is a real, reproducible, silent-data-loss failure mode, not a hypothetical one. Had to manually restore the test file.
- **Bash task** (run the script, report stdout): the tool mechanism itself worked fine (real `python sample/greet.py` command dispatched, real stderr captured: `python: command not found` — this environment only has `python3`). But the model's *reasoning* about the error was wrong: it concluded the script "is not a Python script... e.g. JavaScript" instead of the obvious fix (retry with `python3`). Not a tool-calling failure, but a reasoning-quality failure that would block a real coding task from completing.

With `qwen3-8b-32k` (same 32k-context treatment, same tests):
- Read task: correct, and more efficient than the 1.7B run (no unnecessary extra grep call).
- **Edit task: correct and safe.** Proper diff-style `edit` call with accurate `oldString`/`newString`, docstring inserted exactly as requested, all original code preserved.
- Did not re-run the bash reasoning test at 8B given time already spent (the bash *mechanism* was already confirmed working at 1.7B and is not expected to change with model size) — flagging this as a not-fully-covered gap rather than assuming it's fine.

**This is the headline tradeoff for Nightjar's default local model**: `qwen3:1.7b` is fast and fine for read-only/lookup use, but is not safe to trust with autonomous file edits — it will destructively overwrite files when its first structured attempt fails validation, rather than correcting the attempt. `qwen3:8b` fixes this specific failure mode in direct side-by-side testing, but at real cost — see next finding.

### 4. Hardware-driven latency: 8B-at-32k-context does not fit this GPU, and inference gets slow

`ollama ps` during the 8B tests showed:
```
NAME                   SIZE     PROCESSOR          CONTEXT
qwen3-8b-32k:latest    10 GB    60%/40% CPU/GPU    32768
```
5.2GB of model weights plus the KV cache for a 32k context window totals ~10GB, and only 40% of that fits in the 6GB VRAM budget — the rest runs on CPU. Practical effect: the read-file task took ~3.5 minutes end-to-end (vs. ~1.5 min for 1.7B, which fits fully in VRAM), and the edit task took ~13 minutes across two loop iterations. This is unusable for interactive use as configured. Options to fix, not yet tried: reduce `num_ctx` to something smaller (16k, matching the low end of OpenCode's own recommended range) to shrink the KV cache and get more of the model back onto the GPU; or accept 1.7B for latency-sensitive interactive use and reserve 8B (or better hardware) for slower, higher-stakes autonomous edit tasks. This is a real product decision, not just a config tweak, and should be resolved before Phase 2 assumes any particular latency budget.

### 5. Secondary operational friction (smaller, but real)

- **Headless permission handling**: `opencode run` with no `--auto` flag auto-rejects any permission prompt (e.g., `external_directory` triggered by an absolute-looking path) since there's no interactive user to approve it — silently turns a fixable path mistake into a hard tool failure. Needed `--auto` for all scripted/non-interactive testing. Nightjar's eventual daemon/API mode will need a deliberate permission-policy decision here (auto-approve within workspace, ask for anything outside it), not just "always --auto."
- **One-time `ripgrep` download**: OpenCode's `grep`/`glob` tools download a `ripgrep` binary from GitHub on first use per machine. Fine for a dev machine with internet, but worth pre-bundling for a genuinely "fully offline" product — a fresh offline install would fail the first grep/glob call.
- **Shell timeout wrapper gotcha (environment-specific, not OpenCode's fault)**: `timeout N cmd | tail -M` does not reliably kill `cmd` at N seconds in this sandboxed environment — output is buffered by `tail` until EOF, and `timeout`'s SIGTERM didn't always propagate through the `bun run` → child process tree. Had to redirect to a file and use `timeout -k` instead of piping to `tail` for reliable time-bounded test runs.

## Recommendation going into Phase 2

- Default Nightjar's local-model config to a **Qwen3-family** model (not 2.5, not Gemma), always with an explicit 32k+ `num_ctx` Modelfile override baked into setup — this is now empirically required, not just documentation advice.
- Treat "tool-call format reliability" and "tool-use judgment safety" as two separate things to test per model before shipping a default — a model can pass the first and fail the second in a way that destroys user data.
- Resolve the size-vs-latency tradeoff deliberately (likely: smaller/faster model for read/chat, explicit user confirmation or a larger model for anything that writes files) rather than picking one default model for everything — this interacts directly with Phase 2's plan to let OpenCode autonomously call Row-Bot's MCP tools, several of which (browser automation, memory writes) are exactly the "destructive if judgment fails" category this phase found a live example of.
- Decide the offline-install story for OpenCode's runtime dependency downloads (ripgrep at minimum) before Phase 3.

No changes were made to Row-Bot, the UI plan, or orb-ui. All work is contained in `research/opencode/` (built, unmodified) and the new `phase1-engine/` workspace (config + test fixtures only).
