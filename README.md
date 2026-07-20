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
| **three.js** | Custom voice-reactive vortex orb (WebGL) — replaced orb-ui | MIT |
| **React / React-DOM** | UI framework + DOM renderer for the Electron shell | MIT |
| **marked** | Markdown→HTML in the live-preview panel | MIT |

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

**Since Phase 4:** BYOK cloud-key slots shipped (encrypted key storage + model
switcher + a dismissible cloud banner backed by a persistent ☁ indicator; PRs #6/#8/#98) and the desktop app is verified
running end-to-end. **The final product name is JUNE** — the rename lands with the
UI redesign (Step 7); current strings still say "Nightjar" until then.

The master plan, findings, and the confirmed forward roadmap — **OpenRouter
(rate-limit auto-switch) → image_gen license audit → live-preview panel → Phase 5
OS-computer-use → Phase 6 CAD-by-voice → full UI redesign (final theme + custom orb
+ JUNE rebrand) → form-filling → CLI → Odysseus fork + one-command installer →
"Hey June" wake-word → onboarding → fresh-clone + real-hardware QA → launch** — live
in [`research/AUDIT_REPORT.md`](research/AUDIT_REPORT.md) §10; open issues in
[`KNOWN_ISSUES.md`](KNOWN_ISSUES.md); the build rules Nightjar follows in
[`CLAUDE.md`](CLAUDE.md).

## Setup (fresh clone)

Nightjar depends on two git **submodules**: the **OpenCode** engine (`research/opencode`,
the only agent loop — pinned to the `AxeH666/opencode` fork) and the **Odysseus** source
(`research/odysseus`, a runtime dependency + the AGPL source-availability obligation). Clone
with submodules, then run the setup script (`scripts/setup.ps1` on native Windows):

```bash
git clone --recurse-submodules https://github.com/AxeH666/nightjar.git
cd nightjar
./scripts/setup.sh          # Linux / WSL / Git Bash
```

On **native Windows**, use the PowerShell one-shot instead (see `WINDOWS_SETUP.md §9`):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

Already cloned without `--recurse-submodules`? Fetch both submodules after the fact:

```bash
git submodule update --init
```

`scripts/setup.sh` (or `scripts/setup.ps1` on Windows) fetches **both** submodules,
`bun install`s the OpenCode engine, applies Nightjar's small Odysseus integration patch
(embedded ChromaDB, etc. — see `phase2-odysseus/odysseus-patches/`), creates the Python
venvs (incl. phase-cad) + installs `requirements.txt`, and runs `npm install` for the UI.
It's idempotent.

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

> **Offline caveat:** OpenCode's `grep`/`glob` tools fetch a small `ripgrep` binary on first
> use, so the very first code-search needs network once (cached thereafter).

## Repository layout

```
phase1-engine/     local model + inference proxy + safety plugins
phase2-mcp/        Row-Bot-derived capabilities (MCP) + wake-word daemon + side-channel
phase2-odysseus/   Odysseus MCP wrappers + config + workspace + Odysseus patch
phase3-ui/         Electron + React desktop UI (chat, modes, permissions, voice orb)
research/opencode/ OpenCode engine source — git SUBMODULE (MIT; the only agent loop)
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
(`phase2-odysseus/odysseus-patches/`). The **OpenCode** engine (`research/opencode`) is
likewise a git **submodule**, pinned to the `AxeH666/opencode` fork (a durable fork of
`sst/opencode` so the exact commit stays fetchable). The remaining `research/` clones
(orb-ui, gemma-chat, …) stay git-ignored — development references; the code Nightjar
actually ships from a dependency is vendored (e.g. Row-Bot under
`phase2-mcp/nightjar_capabilities/_vendor/`).

## Hardware / QA notes

Developed on a WSL2 + WSLg box (working display + PulseAudio). The core loops
(engine, capabilities, wake-word, orb) are verified on-box; the trained custom
**"Hey June"** wake model (Step 12) and QA on native (non-WSL) hardware (Step 15,
the last pre-launch step) remain open — see the phase reports and `KNOWN_ISSUES.md`.
