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

The master plan, findings, and forward roadmap (Phases 5–6 + bring-your-own-key)
live in [`research/AUDIT_REPORT.md`](research/AUDIT_REPORT.md); open issues in
[`KNOWN_ISSUES.md`](KNOWN_ISSUES.md); the build rules Nightjar follows in
[`CLAUDE.md`](CLAUDE.md).

## Repository layout

```
phase1-engine/     local model + inference proxy + safety plugins
phase2-mcp/        Row-Bot-derived capabilities (MCP) + wake-word daemon + side-channel
phase2-odysseus/   Odysseus MCP wrappers + config + workspace (opencode.json)
phase3-ui/         Electron + React desktop UI (chat, modes, permissions, voice orb)
research/          upstream reference clones — NOT committed (see below)
```

### Note on `research/` and the Odysseus tier

The `research/` directory holds full upstream clones used during development and is
**git-ignored** (large, re-clonable, each with its own history). **`research/odysseus`
is a runtime dependency** — the Odysseus MCP sidecar runs Python from it — so a fresh
clone must obtain it separately (submodule or a setup step) to enable the
email/RAG/research/PIM tier. Its AGPL attribution
(`research/odysseus/{LICENSE,ACKNOWLEDGMENTS.md,licenses/}`) must ship with any
distribution that includes it.

## Hardware / QA notes

Developed on a WSL2 + WSLg box (working display + PulseAudio). The core loops
(engine, capabilities, wake-word, orb) are verified on-box; a trained custom
"Hey Nightjar" wake model and QA on native (non-WSL) hardware remain open — see the
phase reports and `KNOWN_ISSUES.md`.
