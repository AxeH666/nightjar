# Nightjar Phase 1.5 Report — Model Swap + Safety Harness

Follow-up to Phase 1. Scope: (1) swap the default model to Qwen3-4B-Instruct-2507
Q4_K_M served by llama.cpp; (2) build a safety harness as OpenCode plugins;
(3) add hardware detection. No Row-Bot, UI, or orb-ui work.

## Overall: all three safety points PASS; model swap is a clear win

| Item | Result |
|---|---|
| 1. Model swap (Qwen3-4B-Instruct-2507 Q4_K_M via llama.cpp) | ✅ working; fully GPU-resident; ~18s edits (vs 13 min for 8B); native edits non-destructive |
| 2a. No destructive whole-file write | ✅ PASS (unit + end-to-end) |
| 2b. Git-gate every edit | ✅ PASS (unit + end-to-end); one real bug found & fixed during testing |
| 2c. Doom-loop tightening | ✅ PASS (unit) |
| 3. Hardware detection + startup logging | ✅ working |

---

## 1. Model swap — Qwen3-4B-Instruct-2507 Q4_K_M on llama.cpp

**Why the change (vs Phase 1's Ollama/qwen3 models):** llama.cpp gives control over
the chat template (`--jinja`), KV-cache dtype, and offload that Ollama hides, and
the 4B-Instruct-2507 model fits *fully* in the 6GB VRAM budget where 8B did not.

**Setup performed:**
- Built llama.cpp from the existing `~/llama.cpp` clone with CUDA for the RTX 4050
  (compute 8.9): `cmake -B build-cuda -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=89 -DLLAMA_CURL=OFF`.
  Confirmed `libggml-cuda.so` links and the GPU is detected.
- Model: the official `Qwen/Qwen3-4B-Instruct-2507-GGUF` repo is **gated/auth-required**;
  used `unsloth/Qwen3-4B-Instruct-2507-GGUF` → `Qwen3-4B-Instruct-2507-Q4_K_M.gguf`
  (2.5 GB). (Flagging the gated-official-repo point in case a specific provenance is required later.)
- Server launch (exact flags requested):
  ```
  llama-server -m Qwen3-4B-Instruct-2507-Q4_K_M.gguf --alias qwen3-4b-instruct-2507 \
    --jinja -c 8192 --cache-type-k q8_0 -ngl 99 --host 127.0.0.1 --port 8085
  ```
  VRAM used: **5428 MiB** — fully resident on the 6 GB card (weights + 8k q8_0 K-cache).
- OpenCode wired via the generic `@ai-sdk/openai-compatible` provider pointing at
  `http://127.0.0.1:8085/v1` (see `opencode.json`, provider `llamacpp`).

**Tool-calling reliability — the specific Phase 1 concern:**
- `--jinja` makes llama.cpp emit **proper structured `tool_calls`** (verified directly:
  a raw `/v1/chat/completions` with a tool schema returns a real `tool_calls` array, not
  the bare untagged JSON that the Ollama-served qwen2.5-coder produced and that broke Phase 1).
- **Does it destructively overwrite on a failed edit like qwen3:1.7b did? NO.** Baseline
  (harness OFF) docstring-edit task: the 4B model issued a proper **`edit`** (search/replace),
  not the destructive full-file `write` that 1.7b used. All original code preserved.
- Read, edit, and bash tool tests all pass. On the bash task the 4B model correctly used
  `python3` (this box has no `python`), where 1.7b had mis-reasoned "it must be JavaScript."
- **Speed:** full read→edit round-trip in **~18 s** fully GPU-resident, vs **~13 min** for
  the 8B partial-CPU-offload config in Phase 1. Big usability win.

**Minor quality caveat (not safety):** the 4B model's docstring edit was non-destructive
but slightly malformed once (`def greet(name):"""..."""` on one line — missing newline in the
newString). It preserves all code; it's a correctness-of-edit quality issue, not a data-loss
issue. A syntax/format check on edits would catch it (not in this phase's scope).

---

## 2. Safety harness (OpenCode plugins)

All plugins live in `phase1-engine/.opencode/plugin/*.ts` and load automatically
(confirmed: the startup hwcheck line and gate logs appear on every run). They use the
audited `tool.execute.before` / `tool.execute.after` / `permission.ask` hooks. A thrown
error in a `before` hook becomes the model-facing tool result, which is how blocks steer
the model.

Validation used **two levels**, because a small local model can't be reliably *induced*
into destructive/looping behavior on demand:
- **Deterministic unit tests** (`verify-plugins.ts`, `bun verify-plugins.ts`) drive the
  hooks directly with controlled inputs — **14/14 pass**. This is the authoritative proof.
- **End-to-end** runs through OpenCode + the live model confirm the plugins load and fire
  in the real pipeline.

### 2a. No destructive whole-file write — `nightjar-no-destructive-write.ts` — PASS
- Root cause from Phase 1 (confirmed by reading OpenCode source): the `edit` tool never
  falls back to a full write — it *throws* on a bad edit. The destruction came from the
  **model** then calling `write` with a tiny stub as the whole file. So the guard is on `write`.
- Policy: block a `write` to an **existing, non-trivial** file when it would shrink the file
  below 50% of its size **and** preserve <50% of its non-empty lines. New files, growth, and
  content-preserving rewrites are allowed. Thresholds are explicit constants at the top of the file.
- **Unit:** blocks tiny overwrite (105→13 chars, 0% preserved); allows new-file / growth /
  content-preserving rewrite / non-write tools. ✅
- **End-to-end:** told the model to `write` "DONE" over a 4-line config file → the write was
  **blocked** (`[nightjar-safety] BLOCKED destructive write ... 69->4 chars ... 0% preserved`),
  the model received the instructive error and **recovered by using `edit`** instead of blindly
  destroying the file. ✅
  - Scope note (honest): the guard stops *blind `write` destruction* (the Phase 1 pattern). A
    user who explicitly asks to replace a file's contents can still do so via an `edit` with a
    correct `oldString` — that's intended (it requires actually knowing the content, so it isn't
    the accidental-fallback failure mode).

### 2b. Git-gate every edit — `nightjar-git-gate.ts` — PASS (bug found & fixed here)
- After each edit/write, checks `git status --porcelain`; any file that became dirty **during**
  the tool call that wasn't the intended target is rolled back (`git checkout` / `git clean`);
  intended changes are checkpoint-committed (opt-in via `NIGHTJAR_GIT_CHECKPOINT=1`), giving a
  recovery point.
- **Real bug caught during testing (and fixed):** the first version compared against the last
  commit, so it treated *pre-existing uncommitted files* as out-of-scope and **deleted my own
  uncommitted plugins + `hw-detect.mjs` and reverted `opencode.json`.** Fix: snapshot the set of
  already-dirty files in the `before` hook and only act on files that transition clean→dirty
  during the call; checkpoint stages only the intended paths (never `git add -A`). This is a
  cautionary data point: an over-broad auto-rollback is itself a data-loss risk — the gate must
  be scoped to *this call's* changes.
- **Unit:** with a temp repo — intended file kept, out-of-scope file rolled back, and a
  pre-existing user edit left untouched. ✅
- **End-to-end:** docstring edit → `[nightjar-git-gate] scope OK ... only intended files changed`
  + checkpoint committed only `sample/greet.py`. ✅

### 2c. Doom-loop tightening — `nightjar-doom-loop.ts` — PASS
- Reviewed the built-in detector (`session/processor.ts`, `DOOM_LOOP_THRESHOLD = 3`, matches on
  tool name + byte-identical args, raises a `doom_loop` **permission**). Its weakness in
  autonomous mode: `--auto` **auto-approves** that permission, so the loop isn't actually broken
  (and unattended runs can't answer the prompt at all).
- Tightening: (i) a `permission.ask` hook forces any `doom_loop` request to **`deny`** (headless-safe
  hard stop); (ii) an independent per-session counter hard-blocks the 3rd byte-identical
  (tool,args) call directly from `tool.execute.before`.
- **Unit:** 1st/2nd identical calls allowed, 3rd blocked, different args reset, `doom_loop`
  permission forced to deny, other permissions left as `ask`. ✅

---

## 3. Hardware detection — `hw-detect.mjs` + `nightjar-hwcheck.ts` — working

- Standalone `node hw-detect.mjs` and a startup plugin (`nightjar-hwcheck.ts`, logs once at
  OpenCode launch) both report CPU cores, total/free RAM, GPU name, and total/free VRAM, then
  recommend a model tier. **Detection + logging only — no auto-switching yet, as requested.**
- Design point corrected during testing: the tier is keyed off **total VRAM capability** (a 6 GB
  card is a "4B @ 8k" machine), with **free VRAM** reported separately as a "fits right now" check.
  Keying off free VRAM was wrong — it flip-flopped to the 1.7b tier whenever the desktop
  compositor or the running model held VRAM. On this box: `total VRAM 6141 MiB → tier
  qwen3-4b-instruct-2507-q4 @ 8k`, and it correctly notes when free VRAM is momentarily too low to
  load (e.g. while llama-server already holds it).
- Tiers: coder-30b (≥22 GB) / qwen3-14b (≥14) / qwen3-8b-32k (≥9) / **qwen3-4b @ 8k (≥5, CURRENT)** /
  qwen3-1.7b read-only (≥3.2) / cpu-only.

---

## Friction / findings worth carrying to Phase 2

1. ~~**Small-model long-generation stall (intermittent).**~~ **FIXED — see "Stuck-generation
   timeout fix" below.** (Was: one adversarial run stalled the 4B model in a >300 s looping
   generation that never completed; the doom-loop guard can't catch a single stuck call.)
2. **Git-gate auto-rollback is powerful and dangerous.** The pre-existing-dirty bug shows an
   over-broad rollback can destroy user work. It's fixed and scoped, but Phase 2's Row-Bot MCP
   tools (browser writes, memory writes) will exercise this path harder — keep the gate strictly
   scoped and consider a dry-run/log-only mode before enabling rollback in a real repo.
3. **VRAM is the whole ballgame on this hardware.** 4B @ 8k fully resident is the sweet spot;
   anything larger offloads to CPU and becomes minutes-per-turn. Auto-switching (deferred) should
   pick the model from total-VRAM tier and refuse to load a tier that doesn't fit free VRAM.
4. **llama.cpp server lifecycle** is currently manual (a backgrounded process on :8085). Phase 2/3
   needs this supervised (start/stop/health) as part of Nightjar's own process management.
   *(Update: done in Phase 3 — the Electron supervisor `phase3-ui/src/main/services.ts` manages
   llama-server with adopt-if-healthy + restart-on-crash + health checks.)*
5. Official Qwen GGUF repo is gated; we used Unsloth's. Pin the exact source/quant for reproducibility.

---

## Stuck-generation timeout fix (the Phase 1.5 hazard #1, now closed)

The observed failure was a single model call running unbounded (~300 s, never completing) —
a repetition loop grinding toward the 8k context limit. Root cause confirmed: llama.cpp
`--predict` defaults to **-1 (infinity)**, so a completion runs until EOS or context-full.
The doom-loop guard can't help — it only catches *repeated completed* calls, not one call
that won't end. Fixed with three complementary layers (all validated):

**Layer 1 — wall-clock timeout proxy (`inference-proxy.mjs`)** — the real "timeout".
A tiny Bun HTTP proxy sits between OpenCode and llama-server (`OpenCode → :8086 proxy → :8085
llama-server`) and enforces a hard per-request wall-clock deadline, aborting mid-stream. On
timeout it aborts the upstream fetch (which cancels generation on the server) and closes the
client stream with a timeout marker. Streams pass through untouched otherwise, so normal runs
are unaffected. Env: `NIGHTJAR_INFERENCE_TIMEOUT_MS` (default 90000), `NIGHTJAR_UPSTREAM`,
`NIGHTJAR_PROXY_PORT`. This also becomes the supervised inference endpoint Phase 2/3 needs
(and a natural home for later model routing).
  - **Validated:** a long streaming generation through a 3 s-timeout proxy instance was aborted
    at **3.013 s** (not the ~50 s it would have taken), stream ended cleanly with
    `{"error":{"message":"nightjar inference timeout after 3000ms"}}` + `[DONE]`, proxy logged
    `TIMEOUT mid-stream ... aborted generation`, and llama-server answered the *next* request in
    **0.375 s** — proving the abort propagated and freed the server slot (not just the client).

**Layer 2 — token cap plugin (`nightjar-generation-cap.ts`)** — bounds a loop earlier/cheaper.
A `chat.params` hook sets `maxOutputTokens` (default 2048, env `NIGHTJAR_MAX_OUTPUT_TOKENS`),
which OpenCode passes straight into `streamText`. A repetition loop stops at the cap (~50 s at
this model's rate) rather than the proxy having to fire, saving wasted compute. Only lowers a
caller's cap, never raises it. Unit-tested (3/3).

**Layer 3 — server-side `--predict 2048` + `--timeout 120`** — defense-in-depth independent of
OpenCode. `--predict` gives llama-server its own hard token cap (so even a raw/misbehaving
client can't run unbounded); the lowered socket `--timeout` catches a genuinely hung (no-I/O)
connection. New launch command:
```
llama-server -m Qwen3-4B-Instruct-2507-Q4_K_M.gguf --alias qwen3-4b-instruct-2507 \
  --jinja -c 8192 --cache-type-k q8_0 -ngl 99 --predict 2048 --timeout 120 \
  --host 127.0.0.1 --port 8085
```

Together: token cap bounds *length*, proxy bounds *time*, server cap is a client-independent
backstop. No single model call can run unbounded. End-to-end reads/edits still work normally
through the proxy. All plugin unit tests now **17/17** (added 3 for the generation cap).

**Distinct issue — the pre-request freeze — now FIXED by the run-supervisor watchdog (below).**
Separately from unbounded generation, OpenCode can rarely hang in **session setup before sending
any request** (the proxy sees nothing, so there's no generation to abort; observed only under
near-full memory, ≈300 MiB free with proxy + OpenCode + llama-server all resident). It resolved
on manual retry — unacceptable for a shipped product. Fixed transparently: see below.

---

## Pre-request freeze fix — run-supervisor watchdog (`nightjar-run.mjs`)

The freeze happens *before* any model request, so neither the generation proxy (nothing to
abort) nor an in-process plugin (the process itself is wedged) can catch it. The fix is an
**external supervisor** that launches the OpenCode run and guarantees it reaches the model —
or auto-restarts it — with no user action.

- **Progress signal:** "did a real generation request hit the inference proxy within the
  deadline?" The proxy now exposes `GET /nightjar/stats` → `{genRequests}`, incremented only on
  `chat/completions`/`completions` (health/model-list probes deliberately don't count). This is
  the exact thing that fails during the freeze — unbuffered and independent of OpenCode's output
  format.
- **Behavior:** launch the run (in its own process group); poll the proxy counter. If it
  increments → progress → hand off (the proxy's wall-clock timeout guards the generation from
  there). If the deadline passes with no progress and the run is still alive → it's frozen in
  setup → **kill the whole process group and relaunch automatically**, up to
  `NIGHTJAR_RUN_MAX_ATTEMPTS` (default 3). All attempts frozen → exit non-zero with a
  user-actionable message ("almost always low memory — close other apps and try again").
- **Env:** `NIGHTJAR_FIRST_TOKEN_TIMEOUT_MS` (default 45000 — well above normal first-token
  latency of ~1–9 s here, well below an infinite hang), `NIGHTJAR_RUN_MAX_ATTEMPTS`,
  `NIGHTJAR_PROXY_URL`, `NIGHTJAR_ENGINE_CMD`.
- **Usage:** `bun nightjar-run.mjs run "<prompt>" --model llamacpp/qwen3-4b-instruct-2507 --auto`
  — a drop-in wrapper around `opencode run`. This is where Nightjar's engine driver will invoke
  runs in later phases.

**Validated — `verify-watchdog.sh` (9/9)** using fake engines (freeze simulated by
`tail -f /dev/null`, "reached model" by curling the proxy):
  - happy path reaches the model → progress detected → exits 0;
  - **freeze on attempt 1 → auto-restart → success on attempt 2, exit 0 (user sees no error)** —
    the core requirement;
  - persistent freeze → retries exhausted → exit 1 with the low-memory message;
  - no orphaned frozen processes left behind (process-group kill works).
  Plus a **real end-to-end** run: the watchdog wrapping the actual OpenCode engine detected
  progress, handed off, and completed normally.

Division of labor across the three guards is now clean and non-overlapping:
**watchdog** = run never reaches the model (setup freeze) → restart; **proxy** = request reached
the model but won't finish (runaway/hung generation) → abort; **doom-loop plugin** = repeated
*completed* identical calls → block.

## Artifacts (all under `phase1-engine/`)
- `opencode.json` — llamacpp provider (default) + ollama provider (Phase 1 models retained)
- `.opencode/plugin/nightjar-no-destructive-write.ts`, `nightjar-git-gate.ts`,
  `nightjar-doom-loop.ts`, `nightjar-hwcheck.ts`, `nightjar-generation-cap.ts`
- `inference-proxy.mjs` — wall-clock timeout proxy + `/nightjar/stats` progress oracle (`bun inference-proxy.mjs`, listens :8086)
- `nightjar-run.mjs` — run-supervisor watchdog (auto-restarts a run frozen before reaching the model)
- `hw-detect.mjs` — standalone hardware report
- `verify-plugins.ts` — `bun verify-plugins.ts` → **17/17 pass**
- `verify-watchdog.sh` — `bash verify-watchdog.sh` → **9/9 pass**
- llama-server run command (with `--predict`/`--timeout`) above; model at `~/models/qwen3-4b-instruct-2507/`
- Runtime topology: `OpenCode → http://127.0.0.1:8086 (proxy) → http://127.0.0.1:8085 (llama-server)`
