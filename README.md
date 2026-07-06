# Nightjar

**An offline, local-first AI coding + personal assistant.** Nightjar runs a local
LLM and a suite of capabilities (voice, vision, memory, browser, email, RAG,
research, calendar/notes/tasks) entirely on your own machine — nothing is sent to
the cloud by default.

> **License: [AGPL-3.0-or-later](NIGHTJAR_LICENSE_AND_ATTRIBUTION.md).** Nightjar is
> a combined work built on open-source components; see
> [`NIGHTJAR_LICENSE_AND_ATTRIBUTION.md`](NIGHTJAR_LICENSE_AND_ATTRIBUTION.md) for
> the full license reasoning and upstream attribution.

## What it is

Nightjar composes several open-source projects over **MCP (Model Context Protocol)**
and a small **WebSocket side-channel**, rather than merging codebases:

| Component | Role | License |
|---|---|---|
| **OpenCode** | Core agent engine (the only agent loop) | MIT |
| **Row-Bot** (vendored) | Voice / vision / memory / browser, as an MCP server | Apache-2.0 |
| **Odysseus** (sidecar) | Email / RAG / deep-research / calendar / notes / tasks | AGPL-3.0-or-later |
| **orb-ui** (forked theme) | Voice-reactive orb in the UI | MIT |

The UI is a custom **Electron + React + Vite + Tailwind** shell that talks to a
local `opencode serve` (chat / tools / permissions over HTTP+SSE) and to the
side-channel (wake-word / transcription / TTS / orb state).

## Status

Phases 1–4 are built and reported:

- **Phase 1 / 1.5 — engine + safety harness** ([report](phase1-engine/PHASE1_REPORT.md), [1.5](phase1-engine/PHASE1.5_REPORT.md)): local Qwen3-4B via llama.cpp behind a timeout proxy + run-supervisor watchdog + OpenCode safety plugins.
- **Phase 2 — capabilities** ([report](phase2-mcp/PHASE2_REPORT.md)): Row-Bot's voice/vision/memory/browser re-exposed as a 14-tool MCP server; a live **wake-word daemon** (`phase2-mcp/wake_daemon.py`) drives the "Hey Nightjar" loop.
- **Phase 2b — Odysseus** ([report](phase2-odysseus/PHASE2B_REPORT.md)): email/RAG/research/PIM as MCP sidecars, **embedded ChromaDB (no docker)**.
- **Phase 3 — UI shell** ([report](phase3-ui/PHASE3_REPORT.md)): chat + tool-call cards + explicit mode selector + permission/approval panel + a multi-sidecar supervisor.
- **Phase 4 — voice orb** ([report](phase3-ui/PHASE4_REPORT.md)): orb-ui integrated as a voice-reactive orb + a Siri-style overlay, wired to the live pipeline.

The master plan, findings, and forward roadmap (Phase 5 OS-computer-use → Phase 6
CAD-by-voice → Odysseus fork + one-command installer → name + wake-word → UI
polish → real-hardware QA → launch) live in
[`research/AUDIT_REPORT.md`](research/AUDIT_REPORT.md) §10; open issues in
[`KNOWN_ISSUES.md`](KNOWN_ISSUES.md); the build rules Nightjar follows in
[`CLAUDE.md`](CLAUDE.md).

## Setup (fresh clone)

Nightjar depends on the **Odysseus** source as a git **submodule** (it's both a
runtime dependency and the AGPL source-availability obligation). Clone with
submodules, then run the setup script:

```bash
git clone --recurse-submodules https://github.com/AxeH666/nightjar.git
cd nightjar
./scripts/setup.sh
```

Already cloned without `--recurse-submodules`? Fetch it after the fact:

```bash
git submodule update --init research/odysseus
```

`scripts/setup.sh` fetches the Odysseus submodule, applies Nightjar's small
integration patch to it (embedded ChromaDB, etc. — see
`phase2-odysseus/odysseus-patches/`), creates the Python venvs + installs
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

## Repository layout

```
phase1-engine/     local model + inference proxy + safety plugins
phase2-mcp/        Row-Bot-derived capabilities (MCP) + wake-word daemon + side-channel
phase2-odysseus/   Odysseus MCP wrappers + config + workspace + Odysseus patch
phase3-ui/         Electron + React desktop UI (chat, modes, permissions, voice orb)
research/odysseus/ Odysseus source — git SUBMODULE (AGPL; runtime dependency)
research/*         other upstream reference clones — git-ignored (re-clonable)
```

### Note on `research/` and the Odysseus tier

`research/odysseus` is a **git submodule** pinned to an exact upstream commit of
[Odysseus](https://github.com/pewdiepie-archdaemon/odysseus) — so its **AGPL source
is available** alongside Nightjar and a fresh clone can fetch it with
`git submodule update --init`. The Odysseus MCP sidecar runs Python from it (the
email/RAG/research/PIM tier). Its attribution
(`research/odysseus/{LICENSE,ACKNOWLEDGMENTS.md,licenses/}`) rides along with the
submodule. The submodule is kept a faithful mirror of upstream; Nightjar's two
integration changes are applied on top as a reviewable patch
(`phase2-odysseus/odysseus-patches/`). The **other** `research/` clones (OpenCode,
Row-Bot, orb-ui, …) remain git-ignored — they're development references, and the
code Nightjar actually ships from them is vendored (e.g. Row-Bot under
`phase2-mcp/nightjar_capabilities/_vendor/`).

## Hardware / QA notes

Developed on a WSL2 + WSLg box (working display + PulseAudio). The core loops
(engine, capabilities, wake-word, orb) are verified on-box; a trained custom
"Hey Nightjar" wake model and QA on native (non-WSL) hardware remain open — see the
phase reports and `KNOWN_ISSUES.md`.
