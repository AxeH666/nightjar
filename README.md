# JUNE (formerly Nightjar)

**A cloud-first, quality-first personal assistant.** JUNE prioritizes the best
practical user experience for Voice, Memory, reasoning, vision, and other
intelligence-heavy capabilities, including cloud inference when it delivers
better quality.

The repository still contains local Qwen, faster-whisper, Kokoro/Misaki,
Ollama, embeddings, and memory infrastructure while cloud replacements are
built. Those implementations are transitional scaffolding, not a promise of
offline operation or the long-term quality target.

The approved JUNE 0.1 target uses OpenAI Realtime API with
`gpt-realtime-2.1` over WebRTC after a local privacy gate; the exact model
identifier and account availability must be reverified immediately before
integration. Voice and text will share one visible JUNE-owned canonical
conversation. Canonical Memory will remain local, encrypted, and JUNE-owned;
providers will receive only bounded context under policy.

## Product and architecture authority

Read the JUNE 0.1 PRD, Master Architecture, and applicable subsystem design(s)
before product, architecture, or implementation work:

- [`docs/product/JUNE_0.1_PRD.md`](docs/product/JUNE_0.1_PRD.md) — JUNE 0.1 product requirements and acceptance baseline.
- [`docs/architecture/JUNE_MASTER_ARCHITECTURE.md`](docs/architecture/JUNE_MASTER_ARCHITECTURE.md) — top-level JUNE 0.1 authority and global build order.
- [`docs/architecture/VOICE_SYSTEM_DESIGN.md`](docs/architecture/VOICE_SYSTEM_DESIGN.md) — Voice V1.
- [`docs/architecture/MEMORY_SYSTEM_DESIGN.md`](docs/architecture/MEMORY_SYSTEM_DESIGN.md) — Memory V1.
- [`docs/architecture/ORCHESTRATOR_SYSTEM_DESIGN.md`](docs/architecture/ORCHESTRATOR_SYSTEM_DESIGN.md) — Orchestrator and capabilities.

Subsystem designs refine the Master and cannot silently contradict it.

> **License: [AGPL-3.0-or-later](NIGHTJAR_LICENSE_AND_ATTRIBUTION.md).** Nightjar is
> a combined work built on open-source components; see
> [`NIGHTJAR_LICENSE_AND_ATTRIBUTION.md`](NIGHTJAR_LICENSE_AND_ATTRIBUTION.md) for
> the full license reasoning and upstream attribution.

## What it is

JUNE composes several open-source projects over **MCP (Model Context Protocol)**
and a small **WebSocket side-channel**, rather than merging codebases:

| Component | Role | License |
|---|---|---|
| **OpenCode** | Current agent/session host; target specialised coding capability beneath the JUNE Orchestrator | MIT |
| **Row-Bot** (vendored) | Voice / vision / memory / browser, as an MCP server | Apache-2.0 |
| ~~Odysseus~~ | REMOVED (PRs #139–#147) — every tier deleted or rebuilt Nightjar-side; no Odysseus code remains | — (historical) |
| **three.js** | Custom voice-reactive vortex orb (WebGL) — replaced orb-ui | MIT |
| **React / React-DOM** | UI framework + DOM renderer for the Electron shell | MIT |
| **marked** | Markdown→HTML in the live-preview panel | MIT |

The UI is a custom **Electron + React + Vite + Tailwind** shell that talks to a
local `opencode serve` (chat / tools / permissions over HTTP+SSE) and to the
side-channel (wake-word / transcription / TTS / orb state).

## Status

Phases 1–4 are built and reported:

- **Phase 1 / 1.5 — engine + safety harness** ([report](phase1-engine/PHASE1_REPORT.md), [1.5](phase1-engine/PHASE1.5_REPORT.md)): local Qwen3-4B via llama.cpp behind a timeout proxy + run-supervisor watchdog + OpenCode safety plugins.
- **Phase 2 — capabilities** ([report](phase2-mcp/PHASE2_REPORT.md)): Row-Bot's voice/vision/memory/browser re-exposed as a 14-tool MCP server; a live **wake-word daemon** (`phase2-mcp/wake_daemon.py`) drives the "Hey June" loop (interim stand-in phrase: "hey buddy", until the custom model is trained).
- **Phase 2b — Odysseus** ([report](research/PHASE2B_REPORT.md)): email/RAG/research/PIM as MCP sidecars — since **fully removed** (tiers deleted or rebuilt Nightjar-side, PRs #140–#145; the submodule itself dropped in PR E; image gen is now a BYOK cloud call).
- **Phase 3 — UI shell** ([report](phase3-ui/PHASE3_REPORT.md)): chat + tool-call cards + explicit mode selector + permission/approval panel + a multi-sidecar supervisor.
- **Phase 4 — voice orb** ([report](phase3-ui/PHASE4_REPORT.md)): a voice-reactive orb + a Siri-style overlay, wired to the live pipeline. *(Phase 4 integrated orb-ui; Step 7 later replaced it with a custom three.js orb.)*

**Since Phase 4:** BYOK cloud-key slots shipped (encrypted key storage + model
switcher + a dismissible cloud banner backed by a persistent ☁ indicator; PRs #6/#8/#98). **The final product name is JUNE** — current strings and namespaces may still say "Nightjar" during migration.

The four architecture documents above are the current forward authority.
[`KNOWN_ISSUES.md`](KNOWN_ISSUES.md), [`research/AUDIT_REPORT.md`](research/AUDIT_REPORT.md),
and [`CLAUDE.md`](CLAUDE.md) are historical context where they conflict with
current source, Git, `AGENTS.md`, or the JUNE 0.1 architecture.

## Setup (fresh clone)

Nightjar depends on one git **submodule**: the **OpenCode** engine (`research/opencode`,
the current top-level chat/session host — pinned to the `AxeH666/opencode` fork).
Clone with submodules, then run the setup script (`scripts/setup.ps1` on native Windows):

```bash
git clone --recurse-submodules https://github.com/AxeH666/nightjar.git
cd nightjar
./scripts/setup.sh          # Linux / WSL / Git Bash
```

On **native Windows**, use the PowerShell one-shot instead (see `WINDOWS_SETUP.md §9`):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

Already cloned without `--recurse-submodules`? Fetch the submodule after the fact:

```bash
git submodule update --init
```

`scripts/setup.sh` (or `scripts/setup.ps1` on Windows) fetches the engine submodule,
`bun install`s it, creates the Python venvs (incl. phase-cad) + installs
`requirements.txt`, and runs `npm install` for the UI. It's idempotent.

**Paths are not hardcoded.** Config and code resolve repo-relative paths from
`NIGHTJAR_ROOT` (the desktop app sets it automatically via
`phase3-ui/src/main/services.ts`; the `opencode.json` files use OpenCode's
`{env:NIGHTJAR_ROOT}` / `{env:HOME}` substitution). For manual `opencode serve` /
CLI runs, export it once:

```bash
export NIGHTJAR_ROOT="$(pwd)"
```

(Local model weights, llama.cpp, and Ollama are a separate install — see the
phase reports.)

> **First-run network note:** OpenCode's `grep`/`glob` tools fetch a small `ripgrep` binary on first
> use, so the very first code-search needs network once (cached thereafter).

## Repository layout

```
phase1-engine/     local model + inference proxy + safety plugins
phase2-mcp/        Row-Bot-derived capabilities (MCP) + wake-word daemon + side-channel
engine-workspace/  opencode.json (agents, MCP servers, providers) + the opencode-serve cwd
phase3-ui/         Electron + React desktop UI (chat, modes, permissions, voice orb)
research/opencode/ OpenCode engine source — git SUBMODULE (MIT; current chat/session host, target coding specialist)
research/*         other upstream reference clones — git-ignored (re-clonable)
```

### Note on `research/`

(The Odysseus submodule that used to live at `research/odysseus` was fully removed —
see `NIGHTJAR_LICENSE_AND_ATTRIBUTION.md` and KNOWN_ISSUES NJ-54.)
The **OpenCode** engine (`research/opencode`) is
likewise a git **submodule**, pinned to the `AxeH666/opencode` fork (a durable fork of
`sst/opencode` so the exact commit stays fetchable). The remaining `research/` clones
(orb-ui, gemma-chat, …) stay git-ignored — development references; the code Nightjar
actually ships from a dependency is vendored (e.g. Row-Bot under
`phase2-mcp/nightjar_capabilities/_vendor/`).

## Hardware / QA notes

The founder reported that setup completed from the clean canonical repository
and that native Windows app launch, text chat, BYOK chat, microphone input,
wake, STT, TTS/playback, settings, and normal UI interaction worked. The CAD
environment also passed its smoke test. This is substantial operational
evidence, not a complete production acceptance matrix. The trained custom
**"Hey June"** wake model and formal Windows/audio acceptance remain open. The
same smoke run repeatedly logged a non-blocking failure from
`phase2-mcp\venv\Scripts\python.exe` running `phase2-mcp\task_poller.py`; its root
cause remains unknown.
