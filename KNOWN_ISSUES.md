# Nightjar — Known Issues (tracking)

Issues discovered mid-phase and deliberately deferred to a dedicated pass, so
they don't derail the phase that found them. Newest first. Resolved items are
kept for the historical record with their root cause + fix + verification.

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
