# Nightjar — Known Issues (tracking)

Issues discovered mid-phase and deliberately deferred to a dedicated pass, so
they don't derail the phase that found them. Newest first. Resolved items are
kept for the historical record with their root cause + fix + verification.

---

## 🔧 OPEN

## NJ-10 — permission: a genuinely-undelivered abort leaves no in-UI re-abort control (rare) — OPEN 2026-07-08
- **Severity:** low — only on an actual `POST /session/:id/abort` failure (uncommon
  against the loopback engine), and it does **not** hard-wedge (the composer stays
  usable because `abort()` clears the session's `busy` before the POST).
- **Detail:** in the Stage-4 multi-session permission **queue** (`PermissionContext`),
  a failed `reply()` re-surfaces the ask only when it is genuinely still pending —
  reconciled against the `permission.replied` SSE stream (`repliedIds`) so a lost-ACK
  doesn't create a "zombie" already-answered ask. `abort()` **cannot** use that
  signal: the server resolves an aborted permission by cancelling the fiber and
  **silently deleting the pending permission with no `permission.replied` event**
  (confirmed in the vendored OpenCode source). With no way to tell a lost-ACK
  (already aborted) from a genuinely-undelivered abort, re-surfacing on abort would
  risk a zombie ask masking a live cross-session ask — worse than the residual. So
  abort deliberately does not re-surface: a genuinely-dropped abort leaves the
  session paused server-side with no in-UI re-abort control until reload/reconnect.
- **Root cause:** at-most-once semantics over an unreliable POST, with no engine-side
  ack/idempotency for the "abort resolves a pending permission" path.
- **Fix ideas:** (a) have the engine emit a `permission.replied`-family event when an
  abort cancels a pending permission — then the same reconciliation `reply()` uses
  would cover abort; (b) client-side, add a persistent per-session stop/interrupt
  control (independent of the ask) so a paused session is always abortable even when
  no ask is shown.
- **Scheduled:** documented tradeoff introduced with the multi-session permission
  queue (`feat/ui-redesign-sessions`, PR #23); recorded inline in `PermissionContext.abort()`.
  Revisit if the engine gains an abort-resolved permission event.

## NJ-9 — Create-Image recovery resends the raw prompt as a plain chat message (loses the generate_image directive) — OPEN 2026-07-08
- **Severity:** low — only when a **cloud** image-generation turn fails via
  `session.error`, and the local model *may* still opportunistically call the tool.
- **Detail:** `SessionsContext.createImage()` stores the **raw** description in
  `refs.lastSent`, while the prompt actually sent is the wrapped *"Use the
  generate_image tool…"* directive (never stored). If the image turn fails on a cloud
  model (`session.error` → `handleSessionError`), the recovery offer's `text` is the
  raw prompt; clicking **Retry on local model** runs `send(…, prompt)` and dispatches
  the bare prompt as an **ordinary chat message**, so the model chats *about* the
  prompt instead of regenerating the image.
- **Root cause:** the recovery offer carries no *kind* (chat vs image); `lastSent` is
  the raw prompt, not the directive, and retry always uses the plain `send` path.
  **Pre-existing** — the identical wiring existed in the former single-session
  `ChatContext`; the PR #23 adversarial review surfaced it (did not introduce it).
- **Fix idea:** tag the recovery offer with the send kind (`chat` | `image`) and
  re-dispatch an image retry through `createImage()` (which re-wraps the directive),
  or store the directive-wrapped text for image sends.
- **Scheduled:** small follow-up; natural home is the chat-attachments / image-gen
  path (relates to **NJ-6**/**NJ-7**). Not a blocker for the multi-session PR.

## NJ-8 — live-preview: large single-file artifacts truncate on the local 4B — OPEN 2026-07-07
- **Severity:** low — the live-preview panel *mechanism* (mirror write/edit tool-call content → sandbox → loopback server → iframe + markdown render + download) is implemented and **verified end-to-end** (`phase3-ui/test-preview-e2e.ts`: coffee-shop HTML + markdown doc, 5/5; `test-preview-server.ts` 18/18). Only the model's ability to emit a *big* artifact in one tool call is limited.
- **Detail:** the coding agent writes files via its `write` tool. The local **Qwen3-4B** is capped at `--predict 2048` tokens (a rule-3 safety backstop, `services.ts`). An elaborate single self-contained page can exceed that, so the `write` tool-call JSON is **truncated → the part goes `pending → error` with empty `input`** (observed). The preview correctly renders nothing for an errored write (no partial/garbage file). A **concise** page or a **markdown doc** fits the budget and renders fine; so does any artifact on a **stronger BYOK/OpenRouter model**.
- **Mitigations in place:** the coding-mode system prompt steers previewable artifacts under a (gitignored) `preview/` dir **using the write tool** (not inline), and toward concise output; multi-file output (separate `index.html`/`style.css`/`script.js`) also keeps each write within budget.
- **Fix ideas:** encourage multi-file/concise generation more strongly; raise `--predict` only behind a "design" profile (never the global default — rule 3); rely on a BYOK model for large artifacts.
- **Scheduled:** revisit with the full UI redesign (AUDIT §10 Step 7) and/or a stronger local model; documented behavior of the live-preview feature (`feat/live-preview-panel`).

## NJ-7 — attached-image analysis is model-dependent (local needs Ollama gemma3; Create-Image reliability) — OPEN 2026-07-06
- **Severity:** low — the attach-and-send *mechanism* (paste/drag/browse → file part → agent) works; only the downstream image *analysis* is conditional.
- **Detail:** the local Qwen3-4B is **text-only**, so an attached image is only *seen* directly by a **cloud vision model** (BYOK OpenAI/Anthropic/Google). For the **local** route the composer saves the image to disk + hints the path, and `nightjar_analyze_image` is now permission-granted (assistant mode) — but that tool needs **Ollama + `gemma3:4b`** installed/running; without it the call errors. Text docs (`.txt`/`.md`/…) are read server-side and injected as text, so they work on **any** model.
- **Also:** the **Create Image** button uses a strong directive (OpenCode exposes no client-side `tool_choice`), so a small local model may occasionally not call `generate_image` on the first try.
- **Fix idea:** bundle/guide the `gemma3:4b` install in the installer (Step 11); optionally ship a vision-capable local model (mmproj); if OpenCode adds forced tool-choice, wire Create-Image to it directly.
- **Scheduled:** the gemma3 dependency → installer (Step 11); otherwise documented behavior of the chat-attachments feature (`feat/chat-attachments`).

## NJ-6 — image_gen: cloud path enabled (OpenAI + OpenRouter); local-first backend still pending — PARTIAL 2026-07-07
- **Severity:** medium (was: does not work at all). Chat→image now works via a **cloud**
  endpoint once seeded — either **OpenAI** or **OpenRouter** (auto-wired from the BYOK key,
  OpenAI takes precedence); the **local-first/offline** backend is still pending.
- **✅ Progress (2026-07-06):**
  - **Gap 1 FIXED** — `odysseus-image_generate_image` granted (`"ask"`) in **assistant** mode
    (`opencode.json`), so the agent can call it (still approval-gated, per rule 1).
  - **Gap 2 — cloud endpoint mechanism added + verified.** `phase2-odysseus/seed_image_endpoint.py`
    registers an OpenAI-compatible image endpoint in Odysseus's `model_endpoints` DB (key
    Fernet-encrypted at rest), enables `image_gen_enabled`, and sets `image_model`. **Verified
    end-to-end** by `phase2-odysseus/test_image_gen.py` against a **mock** OpenAI endpoint: the
    real `image_gen_server.py` path resolved the endpoint → POST `/images/generations` → b64
    decode → **wrote a real PNG** → returned a link (PASS).
  - **Gap 2b — auto-wired from the single BYOK key (no separate script).** The main process
    (`phase3-ui/src/main/index.ts`) now runs the seed automatically whenever an **OpenAI**
    key is set/removed in the BYOK panel (`byok:set`/`byok:remove`, passing the decrypted key
    via env → `NIGHTJAR_IMAGE_MODEL=dall-e-3` by default), and re-seeds any stored key at
    startup. So pasting the OpenAI key is the only step — image gen, chat, etc. all work from
    it. Verified end-to-end (mock OpenAI): set→endpoint row (encrypted key decrypts) + image
    generated; remove→endpoint deleted. (`test_image_gen.py`, 4/4.)
  - **Gap 2c — OpenRouter added as a second cloud backend (2026-07-07).** Image gen can now
    also run through **OpenRouter's Unified Image API** (`POST https://openrouter.ai/api/v1/images`,
    request `{model, prompt, …}` → response `{data:[{b64_json}]}` — same shape OpenAI uses, only
    the path differs: `/images` vs `/images/generations`). `image_gen_server.py` picks the dialect
    from the endpoint host (`_image_api_style()`; override `NIGHTJAR_IMAGE_API_STYLE` for tests) and
    relaxes the DALL·E-3 size clamp for non-OpenAI models (FLUX/Seedream/etc). `index.ts` now
    reconciles **one** active image endpoint from the stored BYOK keys with **OpenAI taking
    precedence** — an OpenRouter key wires image gen only when **no OpenAI key** is present
    (default model `openai/gpt-image-1`; override `NIGHTJAR_IMAGE_OPENROUTER_MODEL`). `seed_image_endpoint.py`
    is now provider-neutral (`NIGHTJAR_IMAGE_API_KEY`, back-compat `OPENAI_API_KEY`). **Verified
    end-to-end** against a **mock OpenRouter** endpoint: seed→`/images` POST (never `/images/generations`)
    →b64→PNG→link, host-dialect detection (openrouter.ai→openrouter, api.openai.com→openai),
    encrypted-key row + unseed. (`test_image_gen_openrouter.py`, 7/7; `test_image_gen.py` still 4/4.)
  - ⚠️ **Not yet verified against real OpenAI / real OpenRouter** (no key in this environment; `gpt-image-1`
    needs OpenAI org verification — `dall-e-3`, the auto-wire default, works without). The full
    live **paste-key → chat → approval → image** flow needs a running-app + real-key check, for
    both a real OpenAI key and a real OpenRouter `sk-or-…` key (the Electron `reconcileImageEndpoint`
    precedence + subprocess seed wasn't driven headless here — mock-verified only).
  - **Still OPEN:** the **local-first/offline** backend (Z-Image-Turbo via `diffusion_server.py`)
    is deferred to **Step 11** (installer model-download) as planned — the cloud path above is
    an interim opt-in that sends prompts off-machine.
- **Severity note (original, for history):** image generation **did not work at all** — two
  independent gaps below.
- **Gap 1 — no mode can call the tool.** All three agent modes in `opencode.json`
  (assistant/coding/research) are deny-by-default (`"*": "deny"`) and none whitelists
  `odysseus-image_generate_image`, so the agent is **not permitted to invoke it even when the
  user asks in chat** (correct per rule 1 — the tool was simply never added to an allow-list).
- **Gap 2 — no image endpoint configured (not local-first).** The `odysseus-image` MCP
  (`research/odysseus/mcp_servers/image_gen_server.py`) is API-based and resolves its endpoint
  from **Odysseus's own `ModelEndpoint` DB — NOT Nightjar's BYOK keys** — which is empty, so
  even a permitted call returns "No image model found." As shipped it would only work by
  pointing at **cloud** OpenAI (`gpt-image-1`/`dall-e-3`), contradicting local-first.
- **Root cause:** the tool was never granted to a mode, and the local `diffusers` server
  (`research/odysseus/scripts/diffusion_server.py`) exists but is launched/wired nowhere with
  no `image_model` configured.
- **Fix idea (Step-3 audit recommendation):** (a) grant `odysseus-image_generate_image` to a
  mode (e.g. assistant, `"ask"`); (b) run `diffusion_server.py --model Tongyi-MAI/Z-Image-Turbo`
  (Apache-2.0, ~6 GB VRAM) as a managed sidecar and register it as the Odysseus image endpoint;
  pull the model in the installer's model-download step. **Never** default to FLUX.1-dev / SD 3.5
  (non-commercial / community-licensed). Full audit + license table:
  `NIGHTJAR_LICENSE_AND_ATTRIBUTION.md` → "Image-generation model licenses".
- **Scheduled:** small implementation task — natural home is the **one-command installer**
  (Step 11, model download) + a one-line `opencode.json` permission grant. The license audit
  itself (Step 3) is ✅ done.

## NJ-5 — BYOK key change can't be applied to an *adopted* opencode-serve — OPEN 2026-07-06
- **Severity:** low — only affects the adopt path (a `opencode serve` already on
  :4096 when Nightjar starts, e.g. a leftover/dev instance); the normal path
  where Nightjar spawns the engine is unaffected.
- **Symptom:** adding/removing a cloud key does not take effect; the key stays
  inert until Nightjar (and the engine) is fully restarted.
- **Root cause:** the supervisor adopts a healthy service by *port probe* and
  never captures the external PID, so `restartService()` has no process to stop
  and cannot re-exec it with the new `NIGHTJAR_BYOK_*` env.
- **Mitigation shipped (feat/byok-cloud-keys):** `restartService()` now detects
  this instead of spawning a colliding second engine that the stale one would
  shadow — it surfaces an "adopted / can't apply" state + health-strip detail
  telling the user to restart Nightjar. So the failure is honest, not silent.
- **Fix idea:** capture the PID at adoption (port→PID lookup) so adopted services
  can be cleanly restarted, or offer to take over the port.
- **Scheduled:** **Step 15 (real-hardware QA)** in the `AUDIT_REPORT.md` §10 confirmed
  order — the adopted/leftover-engine scenario is exercised during multi-process
  real-hardware testing, and the supervisor lifecycle fix lands with it.

## NJ-4 — Renderer SSE stream does not auto-reconnect after an engine restart — FIX IMPLEMENTED (runtime-verify pending) 2026-07-08
- **Severity:** medium — chat silently stops working (dead stream + stale session
  id) until a full window reload.
- **Symptom:** after `opencode-serve` restarts, the renderer keeps its original
  one-shot SSE subscription and session id; new prompts target a session that no
  longer exists and no events arrive.
- **Root cause:** the connect `useEffect` in `App.tsx` subscribes exactly once and,
  on stream close, only calls `setStatus("stream closed…")` — it never re-enters
  the connect/retry loop. Predates BYOK; the supervisor's crash→auto-restart of
  opencode-serve already triggered it.
- **Mitigation shipped (feat/byok-cloud-keys):** the BYOK-triggered restart now
  forces a reconnect (recreate session + resubscribe) via a `reconnectTick`. The
  **crash-restart** path is still uncovered.
- **Fix idea:** on SSE close, re-enter the bounded connect/retry loop (the same one
  used at startup) instead of parking on a status string.
- **Fix (implemented — redesign Stage 3, 2026-07-08, `feat/ui-redesign-nj4`):** in the
  reworked connection layer (`phase3-ui/src/renderer/src/context/ConnectionContext.tsx`),
  the single SSE subscription now re-enters the bounded connect/retry loop on **any**
  stream termination — a clean close (`.then`) OR an error (`.catch`) — not just the
  BYOK restart; both bump the same `reconnectNonce`, recreating the session + resubscribe.
  A 1s settle floor plus the loop's existing 2s `listAgents` backoff bound flapping if the
  engine crash-loops; an aborted-guard prevents a reconnect fired after teardown so it
  never double-connects.
- **Verification:** ⚠️ **PENDING** — implemented in a headless env with no reachable
  opencode-serve, so the actual kill-engine → auto-resubscribe → working-prompt path was
  NOT driven end-to-end (CLAUDE.md rule 6). Drive it on a live stack before moving this to
  RESOLVED.

---

## ✅ RESOLVED

## NJ-3 — Duplicate messages in the chat surface — FIXED 2026-07-05
- **Severity:** medium — UX; no data loss.
- **Symptom:** the user's message rendered twice in `ChatSurface`.
- **Root cause (confirmed by capturing the real SSE stream during a prompt):**
  `send()` optimistically adds the user's message with a client id
  (`local-<ts>`), and OpenCode *also* echoes the same user message over the
  event stream with its own server id (`msg_…`, `role:"user"`) plus a text
  part. `handleEvent` created a second message for that server id → the user's
  turn rendered twice. A latent second bug compounded it: the
  `message.part.updated` handler hard-coded `role:"assistant"` for every part
  (`part.messageID === sessionRef.current ? "assistant" : "assistant"` — both
  branches identical).
- **Fix (`phase3-ui/src/renderer/src/App.tsx`):** track `roleById` from
  `message.updated`, only render **assistant** messages/parts from the server,
  and drop the server's echo of the user message (the client already renders it
  optimistically). Removed the dead ternary.
- **Verified:** loaded the real built app against the live stack, sent a real
  message, counted rendered bubbles in the DOM → `you: 1, nightjar: 1` (exactly
  once each). Screenshot confirms a single "YOU" + single "NIGHTJAR" bubble.

## NJ-2 — Mode selector showed OpenCode's built-in agents — FIXED 2026-07-05
- **Severity:** low — cosmetic clutter (selecting Build/Plan ran OpenCode's
  stock agents instead of a Nightjar mode).
- **Root cause:** `OpenCodeClient.listAgents()` filtered only `hidden!==true`
  and `mode!=="subagent"`; OpenCode's `build`/`plan` are non-hidden primary
  agents, so they passed. Confirmed via `GET /agent`: `build`/`plan` carry
  `native:true`; Nightjar's own modes carry `native:false`.
- **Fix (`phase3-ui/src/renderer/src/lib/opencode.ts`):** add `native !== true`
  to the `listAgents()` filter. Robust — any agent defined in our
  `opencode.json` is `native:false`, so no hardcoded name list is needed and
  future Nightjar modes appear automatically.
- **Verified:** ran the real `listAgents()` against the live server →
  `["assistant","coding","research"]` exactly (no build/plan). Screenshot of the
  running app shows the header selector with only Assistant / Coding / Research.

## NJ-1 — Agent identified itself as "Odysseus" instead of "Nightjar" — FIXED 2026-07-05
- **Severity:** medium — branding + trust.
- **Root cause (confirmed by live probing):** the `research` and `coding` agent
  prompts contained **no identity anchor** ("You research a topic…", "You are a
  coding agent…"), while the system prompt is saturated with the string
  "odysseus" — every Odysseus tool is namespaced `odysseus-*` (in the always-present
  tool list) and OpenCode injects an `<mcp_instructions><server name="odysseus-…">`
  block per server (`packages/opencode/src/session/system.ts`). With no
  counter-signal, the model latched onto that. Reproduced pre-fix: `research`
  mode answered *"I am not Odysseus or Nightjar… I leverage the capabilities of
  Nightjar and Odysseus"* — explicitly disowning its Nightjar identity. (Note:
  the MCP servers do **not** set an explicit persona via `instructions=`; the
  leak was the namespace + missing anchor, not an injected "you are Odysseus".)
- **Fix (`phase2-odysseus/workspace/opencode.json`):** prepend a strong, shared
  identity rule to **all three** agent prompts — asserts "You are Nightjar",
  states that `odysseus-`/`nightjar_`/`row-bot` prefixes are internal component
  names (not identity), and forbids identifying as Odysseus/OpenCode/Row-Bot.
- **Verified:** after reloading the config, re-ran the identity-pressure probe
  in all three modes → each answers "I am Nightjar… not Odysseus/Row-Bot".
  Also confirmed identity holds *after invoking a real Odysseus tool*: in
  assistant mode, "list my notes then tell me your name" returned the real notes
  via the `odysseus-pim` tool and still answered "My name is Nightjar."
