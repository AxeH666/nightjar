# Nightjar Phase 3 Report — UI shell (chat + mode + approval)

> **⚠️ Post-Phase-4 correction (2026-07-05):** the "headless box, no display /
> visual QA needs a machine with a display" caveat in this report was **wrong**.
> This box runs **WSLg** (working X display + PulseAudio); the Nightjar UI was
> later launched and screenshotted in every state and a real audio wake→reply→TTS
> loop ran on-box. See `PHASE4_REPORT.md` (UPDATE) / `research/AUDIT_REPORT.md`
> (Status). Everything below is Phase 3's accurate record *at the time*.

Scaffold the custom UI (Electron + React + Vite + Tailwind, locked theme), built
against the confirmed OpenCode API contract, talking to a **real running OpenCode
instance**. No orb-ui/voice wiring yet (Phase 4). No visual/GUI verification here
(headless box, no display) — the **data layer is proven end-to-end**; the React
render layer is proven to compile/build.

## Result: builds clean, typechecks clean, 10/10 integration tests pass vs real OpenCode

- `electron-vite build` ✅ — all three processes (main/preload/renderer) bundle; Tailwind emits.
- `tsc --noEmit` (node + web) ✅ — zero type errors.
- **Integration test (`test-integration.ts`) drives the ACTUAL UI client module (`lib/opencode.ts`) against `opencode serve` on :4096 — 10/10 PASS**, including the permission round-trip.

## What was built (`phase3-ui/`)

- **Electron shell**: `src/main/index.ts` (window, `#14110D` bg to avoid white flash, exposes OpenCode URL via IPC), `src/preload/index.ts` (minimal `nightjar.getConfig` bridge). Sidecar supervision deferred (this shell talks to an already-running OpenCode).
- **Theme LOCKED** in `tailwind.config.js` as `nightjar.{base,surface,accent,text,alert}` = `#14110D / #2A2419 / #C9852E / #EDE6D6 / #A13D2B`. Used throughout; no default Tailwind palette.
- **`lib/opencode.ts`** — the API client, portable (fetch + ReadableStream SSE parser; runs in renderer AND Node/bun): `listAgents`, `createSession`, `promptAsync(agent, model)`, `subscribe` (SSE), `replyPermission(once|always|reject)`, `abort`. Plus `toolCallFromPart()` folding `message.part.updated` ToolParts into a `ToolCall` keyed by `callID`.
- **Components**: `ChatSurface` (message list + composer, renders text + tool cards), `ToolCallCard` (advances pending→running→completed/error by callID), `ModeSelector` (explicit; never auto-switches), `SuggestionBanner` (rules-based, non-blocking, via `lib/suggestMode.ts`), `PermissionPanel` (the critical one), `OrbPlaceholder` (amber mounting point, non-interactive).
- **`App.tsx`** wires it: connect → `listAgents` → default to `assistant` → `createSession` → `subscribe` (filtering every event by our `sessionID`, since the stream is instance-wide) → send prompts with the active mode → surface tool cards, streaming text, permission asks.

## Permission/approval UX — built to the non-negotiable spec, verified

- On `permission.asked`, a **modal rust-red (`nightjar.alert`) card** overlays everything ("Approval needed — the agent is paused until you answer"), impossible to miss.
- Reply options are **`once` / `always` / `reject`** (not allow/deny). `always` is surfaced contextually — e.g. "Always allow sending to <recipient>", "Always allow edits to <path>" (`humanAction()` maps the permission + metadata to human text).
- **Abort escape hatch** is always present (`POST /session/:id/abort`) — because permissions have **no server-side timeout and block the agent loop indefinitely**, a user who doesn't want to answer can bail instead of wedging the run.
- **Verified live:** the coding agent's edit fired `permission.asked` (permission=edit) → the client's `replyPermission(id,"once")` → the write proceeded → `note.txt` was actually created. Full SSE-ask → HTTP-reply → tool-proceeds loop confirmed against the real server.

## Integration test results (10/10, real OpenCode)

| Check | Result |
|---|---|
| `GET /agent` returns research/assistant/coding | ✅ |
| `GET /agent` filters out subagents/hidden | ✅ |
| `POST /session` creates a session | ✅ |
| `POST /session/:id/prompt_async` with per-request `agent` | ✅ |
| SSE streamed a tool-call ToolPart (`message.part.updated`) | ✅ (`write:completed`) |
| `permission.asked` streamed to the client | ✅ (permission=edit) |
| Tool reached `completed` after approval | ✅ |
| Approved write actually created the file | ✅ |
| Assistant produced streaming text | ✅ |
| `POST /session/:id/abort` returned OK | ✅ |

## Friction hit against the real API (two real findings)

1. **`model` is a `ModelRef` OBJECT, not a `"provider/model"` string.** First prompt got `400 BadRequest: Expected object | null, got "llamacpp/qwen3-4b-instruct-2507" at ["model"]`. Fixed: the client splits the string into `{ providerID, modelID }`. (Worth noting the plan's §9 said `model` was per-prompt but not its shape — now pinned.)
2. **Per-mode `tools:{x:true}` = ALLOW (auto-approve), which SUPPRESSES the permission gate.** The first run of the coding agent (scoped via the `tools` map) wrote the file with **no** `permission.asked` — because allowing a tool in the `tools` map compiles to an `allow` rule, so it never prompts. **Scoping and gating are different levers:** `tools:{x:false}` hides a tool; `permission:{x:"ask"}` keeps it visible AND gated; `permission:{x:"allow"}` = auto-approve. **Corrected guidance:** define Nightjar modes with the **`permission` field** (per-tool `ask`/`allow`/`deny`) for anything that should prompt (edit/write/bash/email-send), and reserve the `tools` boolean map for hard-hiding. Re-verified: with `coding.permission = { edit:"ask", write:"ask", bash:"ask", read:"allow", … }`, `permission.asked` fires correctly.

Minor: `GET /agent` also returns OpenCode's built-in primary agents (`build`, `plan`) alongside the Nightjar modes — the UI currently shows all non-hidden/non-subagent agents; a later pass may want to present only Nightjar's three (a cosmetic filter).

## Not done (as scoped)
- No orb-ui integration, no voice/wake wiring (Phase 4).
- **No visual GUI verification** — headless box has no display; the window wasn't rendered/screenshotted. Data layer + build/typecheck are the evidence here; visual QA needs a machine with a display.
- Electron sidecar supervisor (launch llama-server/proxy/MCP/side-channel from main) still deferred — the shell assumes OpenCode is already serving.

## For Phase 4 / next
- Wire orb-ui into `#nightjar-orb-mount` off the side-channel WS (state + volume).
- Visual QA on real hardware.

---

# UPDATE — permission-gate fix + sidecar supervisor (post-review follow-ups)

### 1. Permission-gate bug — FIXED ✅ (the safety system)
Root cause: agent modes defined via the `tools:{x:true}` map compile to *allow* rules → the tool is auto-approved and **no `permission.asked` fires**. Fix: define modes via the **`permission` field**, where a tool set to `"ask"` stays visible AND gated, `"allow"` runs freely, and `"*":"deny"` scopes everything else out (scoping + gating in one field).
- **Validated** in the fast test workspace: with `permission:{"*":"deny","edit":"ask","write":"ask","read":"allow",…}`, `permission.asked` (permission=edit) **fired** even under the wildcard deny, the write completed after `once`, and the file was created — proving a specific `"ask"` overrides `"*":"deny"` for visibility while gating the call.
- **Applied to the real modes** (`phase2-odysseus/workspace/opencode.json`): `research` → `deep_research:"allow"`, **`send_email:"ask"`**; `assistant` → PIM/memory/docs/list `"allow"`, **`send_email:"ask"`**; `coding` → reads `"allow"`, **`edit`/`write`/`bash`:"ask"**; all with `"*":"deny"`. The email-send approval gate (and edit/shell gates) now actually reach the UI's permission panel. The mechanism is tool-name-agnostic (validated on `edit`; `send_email` gates identically).

### 2. Electron multi-sidecar supervisor — BUILT ✅ (`src/main/supervisor.ts` + `services.ts`)
A pure-Node `Supervisor` the Electron main process runs: dependency-ordered start, **adopt-if-already-healthy** (won't double-spawn), readiness gating, **restart-on-crash with backoff**, periodic health checks, and clean **process-group shutdown**. Manages the real stack: `llama-server` (:8085), `inference-proxy` (:8086), `opencode-serve` (:4096, which itself spawns the MCP servers), `side-channel` (:8765). Wired into `main/index.ts` with status pushed to the renderer over IPC; a `HealthStrip` component shows per-service dots, and `App` now **retries the OpenCode connection** until the engine is up (survives cold model load).
- **Validated 9/9** (`test-supervisor.ts`, against the real stack): llama-server **adopted** (not re-spawned); proxy/opencode/side-channel **spawned + healthy**; killing the proxy → **auto-restarted** (new pid, healthy); clean **shutdown** stopped owned services while the adopted llama-server survived.

**Net:** the whole stack now comes up reliably from the app, self-heals on a sidecar crash, and tears down cleanly — the "running reliably before adding voice" bar is met. Still deferred: orb-ui/voice (Phase 4), visual GUI QA on real hardware.
