# Nightjar — Known Issues (tracking)

Issues discovered mid-phase and deliberately deferred to a dedicated pass, so
they don't derail the phase that found them. Newest first. Resolved items are
kept for the historical record with their root cause + fix + verification.

---

## 🔧 OPEN

## NJ-6 — image_gen is unreachable: not granted to any mode + no local backend wired — OPEN 2026-07-06
- **Severity:** medium — image generation **does not work at all today** (two independent
  gaps), and the intended backend isn't local-first either.
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

## NJ-4 — Renderer SSE stream does not auto-reconnect after an engine restart — OPEN 2026-07-06
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
- **Scheduled:** **Step 7 (full UI redesign)** in the `AUDIT_REPORT.md` §10 confirmed
  order — the renderer's connection layer is reworked there, the natural place to
  generalize the shipped `reconnectTick` to auto-reconnect after *any* engine restart.

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
