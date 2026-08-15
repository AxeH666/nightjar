# JUNE Project Context

This is durable project context. Volatile branch, issue, and worktree state belongs in `STATUS.md`.

Evidence labels used here:

- **Confirmed** — supported by current code, Git, configuration, or direct inspection.
- **Inferred** — the strongest explanation of confirmed evidence, but not explicitly decided.
- **Unknown** — repository evidence does not settle it.

## Identity and mission

**Confirmed:** JUNE and Nightjar are the same project. Nightjar is the original repository/code name; JUNE is the product name (`JUNE_context.md:9-10`). Internal paths, environment variables, package names, and prompts still commonly use `nightjar` or `NIGHTJAR_*`.

**Confirmed product direction:** JUNE's mission is to become a real-life JARVIS-like assistant: wake-word activated, voice-first, conversationally intelligent, able to use tools and create CAD/design work, and eventually able to control broader computer workflows safely.

**Important:** this mission is intended vision, not proof of current capability.

## Architecture authority

The founder-approved JUNE 0.1 architecture is tracked in:

- [`docs/architecture/JUNE_MASTER_ARCHITECTURE.md`](docs/architecture/JUNE_MASTER_ARCHITECTURE.md) — top-level product, ownership, safety, and global implementation-order authority.
- [`docs/architecture/VOICE_SYSTEM_DESIGN.md`](docs/architecture/VOICE_SYSTEM_DESIGN.md) — Voice V1 subsystem design.
- [`docs/architecture/MEMORY_SYSTEM_DESIGN.md`](docs/architecture/MEMORY_SYSTEM_DESIGN.md) — Memory V1 subsystem design.
- [`docs/architecture/ORCHESTRATOR_SYSTEM_DESIGN.md`](docs/architecture/ORCHESTRATOR_SYSTEM_DESIGN.md) — Orchestrator and capability subsystem design.

Read the Master and applicable subsystem designs before architecture or implementation work. Subsystem documents refine the Master and cannot silently contradict it.

## Current architecture

**Confirmed:** JUNE is a source-run desktop application built around these layers:

1. An Electron main process launches the React renderer and supervises local services (`phase3-ui/src/main/index.ts`, `phase3-ui/src/main/services.ts`, `phase3-ui/src/main/supervisor.ts`).
2. OpenCode currently hosts the desktop's top-level chat/session path and several general-assistant flows. It runs from the pinned `research/opencode` submodule through Bun, with `engine-workspace/` as its workspace (`phase3-ui/src/main/services.ts:170-193`, `phase3-ui/src/renderer/src/context/ConnectionContext.tsx:122-128`, `phase2-mcp/wake_daemon.py:482-528`). In the target architecture it becomes JUNE's specialised coding capability beneath the Orchestrator, not the universal assistant brain.
3. The renderer talks to OpenCode over loopback HTTP/SSE on port 4096.
4. OpenCode starts seven local stdio MCP servers configured in `engine-workspace/opencode.json:114-171`.
5. A WebSocket side-channel on port 8765 carries wake, transcription, TTS, and orb events. The wake daemon also exposes health on port 8766 (`JUNE_context.md:145-155`).
6. The checked-out supervisor still defines llama.cpp on 8085, an inference proxy on 8086, and optional Ollama vision on 11434.

The Electron app is the launcher and process supervisor. It starts services in dependency order, adopts healthy existing services, checks readiness, restarts failed processes with backoff, and shuts down process trees (`JUNE_context.md:157-165`).

## Main components

| Component | Current role |
|---|---|
| `phase3-ui/` | Electron main process, preload bridge, React UI, chat/session state, permissions, orb, previews, CAD viewer, and service supervisor |
| `engine-workspace/` | Runtime OpenCode agents, prompts, provider configuration, permission maps, and MCP server definitions |
| `research/opencode/` | Pinned OpenCode engine submodule; current agent/session host, targeted to become the specialised coding capability |
| `phase2-mcp/` | Wake daemon, side-channel, voice, memory, vision, PIM, web search, research, and image-generation MCP services |
| `browser-use-mcp/` | Browser automation MCP with a persistent local profile |
| `phase-cad/` | Python 3.12 build123d CAD service, STEP export/conversion, validation, and measurement tools |
| `telegram-scheduler/` | Separate Telegram scheduling service; not wired into the desktop app |

## Current capabilities

**Confirmed as code-present, not necessarily live-verified:**

- Electron chat UI with OpenCode sessions, SSE streaming, tool-call cards, modes, and permission prompts.
- Memory plus notes, tasks, calendars, and events.
- Browser automation, web search, deep research, vision, attachments, and cloud image generation.
- A wake-to-reply voice path with transcription, an OpenCode turn, speech synthesis, and renderer playback.
- Live preview/artifact handling under a per-session sandbox.
- Prompt-to-CAD through a dedicated CAD agent and MCP server.
- A separate Telegram scheduler deployable.

## Important non-capabilities

**Confirmed absent or incomplete:**

- No production `hey_june.onnx` model is tracked. Runtime may load `NIGHTJAR_WAKEWORD_MODEL` or an external `~/.nightjar/models/hey_june.onnx`; otherwise the repository falls back to `hey-buddy.onnx` (`phase2-mcp/nightjar_capabilities/wakeword.py:140-150`, `KNOWN_ISSUES.md:223-276`).
- No general named UI action API, command registry, centralized navigation model, or broad computer-control layer (`phase3-ui/src/preload/index.ts`, `phase3-ui/src/renderer/src/shell/AppShell.tsx`).
- Voice turns use a separate OpenCode session that the visible renderer session does not adopt. Voice conversation and tool activity are therefore not generally visible in the main chat (`phase2-mcp/wake_daemon.py:433-523`, `phase3-ui/src/renderer/src/context/ConnectionContext.tsx:79-143`).
- Natural-language CAD construction exists, but general voice control of CAD camera, selection, panels, and app navigation does not.
- Sentence-by-sentence voice-reply streaming is not implemented.
- No production desktop installer, signing, update, rollback, or release pipeline is present.
- No unified JUNE-owned migration/rollback strategy exists across all stores, and no CI pipeline is present. OpenCode has its own generated timestamped migrations; PIM has a one-time legacy data-copy migration.

## Voice pipeline and privacy boundary

**Confirmed current code path:**

```text
microphone
  -> local ONNX wake detector (repository fallback: "hey buddy"; runtime-overridable)
  -> bounded audio capture
  -> local faster-whisper transcription
  -> separate persistent OpenCode voice session
  -> selected chat model
  -> local Kokoro ONNX speech synthesis
  -> WebSocket side-channel
  -> renderer audio playback and orb state
```

The wake daemon drives voice directly. Voice MCP tools are intentionally denied to all agents so a model cannot independently open the microphone or emit arbitrary audio (`engine-workspace/opencode.json:114-122`).

Under the current cloud-inference decision, on-device wake detection is the critical privacy gate. A false wake can submit an ambient-speech transcript to a paid remote model. Voice/privacy controls must therefore fail closed.

## OpenCode and MCP

**Confirmed:** `engine-workspace/opencode.json` is the runtime source of truth for agents, model/provider wiring, MCP servers, and tool permissions. Primary agents include assistant, research, web search, CAD, and coding. Tool access is controlled through explicit permission maps.

**Confirmed target role:** OpenCode remains during incremental migration, but the JUNE 0.1 architecture assigns durable orchestration, permissions, actions, canonical conversation, and Memory ownership to JUNE. OpenCode is the specialised coding capability.

The seven configured MCP servers are `nightjar`, `nightjar-image`, `nightjar-websearch`, `nightjar-research`, `nightjar-pim`, `browser-use`, and `cad-build123d` (`JUNE_context.md:169-188`). Backend/world actions are extensive; UI actions are not.

**Confirmed current security boundary:** these services are loopback-only, but the WebSocket side-channel accepts and rebroadcasts messages without authentication, origin checks, or producer roles (`phase2-mcp/sidechannel.py:43-59`). The renderer also constructs its OpenCode client without an auth token (`phase3-ui/src/renderer/src/context/ConnectionContext.tsx:122-128`). Broader computer control must not be built on this boundary unchanged.

## CAD subsystem

**Confirmed:** CAD uses Python 3.12, `build123d`, and `build123d-mcp`. The agent works through an execute -> measure/render/validate -> export loop. Mutating CAD tools require permission. The desktop converts exported STEP geometry to GLB and displays it in a three.js viewer (`phase-cad/README.md:4-12`, `engine-workspace/opencode.json:69-92`, `phase3-ui/src/main/cad.ts`).

CAD-by-language is implemented. CAD-by-general voice/app control remains incomplete because the shared session, command, navigation, camera, and selection layers do not exist.

## Storage and data locations

**Confirmed:** data is split across several local stores:

- `~/.nightjar/` or `C:\Users\<user>\.nightjar\`: memory database/vectors, browser profile, models, PIM SQLite, attachments, generated images, previews, and logs (`phase2-mcp/nightjar_capabilities/config.py:11-16`, `phase2-mcp/pim_db.py:9-47`, `phase3-ui/src/main/index.ts:195-219`).
- Electron `userData`: UI settings and BYOK key records. Keys use Electron `safeStorage` when available (`phase3-ui/src/main/byok.ts:3-12,93-171`).
- Renderer `localStorage`: projects, session scopes, pins, and unread state (`phase3-ui/src/renderer/src/lib/projects.ts`, `sessionScope.ts`).
- OpenCode's XDG data area: its own SQLite database in WAL mode (`research/opencode/packages/core/src/database/database.ts:27-40`).
- Telegram scheduler: a separate SQLite store.

There is no single backup/export boundary or unified migration/rollback strategy. OpenCode applies its own generated timestamped migrations (`research/opencode/packages/core/src/database/database.ts:27-34`); PIM has a one-time legacy copy migration (`phase2-mcp/pim_db.py:111-175`), while other JUNE stores do not share one versioned scheme.

## Cloud and local inference

**Confirmed founder decision (NJ-93):** JUNE is cloud-first and quality-first.
Offline operation and local inference parity are no longer product requirements.
The best practical provider-backed path should become primary for Voice,
reasoning, vision, and other intelligence-heavy capabilities as focused
migrations are implemented. Canonical Memory remains a local, encrypted,
JUNE-owned system; providers may receive only bounded Memory context.

**Confirmed current transition state:** local Qwen/llama.cpp, faster-whisper,
Kokoro/Misaki, Ollama vision, local embeddings, and local memory infrastructure
still exist. They may remain temporarily while replacements are validated, but
they are not the long-term quality target. The historical
`docs/nj93-cloud-decision` branch is evidence only and must not be merged or
cherry-picked.

**Privacy consequence:** current STT is local, but a selected cloud chat model
receives the resulting transcript. Under the approved target, Voice V1 may
transmit post-wake audio to OpenAI Realtime only after the local privacy gate.
Memory providers may process bounded context, embeddings, summaries, or
retrieved memories, but do not own the canonical Memory store.

**Confirmed target decisions:** Voice V1 uses OpenAI Realtime API with
`gpt-realtime-2.1` over WebRTC; voice and text share one visible JUNE-owned
canonical conversation; canonical Memory is local and encrypted; and the JUNE
Orchestrator owns durable work, policy, actions, verification, and capability
delegation. The exact realtime model identifier and account availability must
be reverified immediately before integration. Exact implementation libraries
and tuning remain reviewable behind those boundaries.

## Architectural gaps blocking the JARVIS vision

1. Implement the approved shared JUNE-owned voice/text conversation and migrate away from the hidden voice-only session.
2. Add a typed, permission-aware command channel and named action registry for the renderer.
3. Lift or centralize navigation, project, CAD camera/selection, and lifecycle state so actions are addressable.
4. Replace the stand-in wake model and close false-wake, consent, kill-switch, and fail-open microphone paths.
5. Implement cancellable sentence-by-sentence voice streaming with correct TTS/playback lifecycle.
6. Authenticate the current loopback OpenCode/side-channel control surfaces before exposing broader computer-control actions.
7. Establish isolated tests, CI, migrations, backups, packaging, signing, updates, and production observability.
