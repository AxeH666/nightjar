# JUNE (Nightjar) — Full Project Context

> **Purpose:** a single, self-contained briefing on what this project is, how it's built, what
> it depends on, where it stands, and what to watch when migrating to native Windows. Written
> to be pasted into a fresh chat as decision-making context. Everything here is grounded in the
> actual repo (deps read from the real `requirements.txt`/`pyproject.toml`, topology from
> `services.ts`/`supervisor.ts`/`opencode.json`), not from memory.
>
> **Codename note:** the repo/code says **Nightjar**; the final product name is **JUNE**. The
> rename lands with the UI redesign — current strings still say Nightjar. Same thing.

---

## 1. What this is

**An offline, local-first AI coding + personal assistant + engineering workbench.** It runs a
local LLM and a suite of capabilities (voice, vision, memory, browser, email, RAG, research,
calendar/notes/tasks, prompt-to-CAD) **on your own machine** — nothing goes to the cloud by
default. Cloud is strictly opt-in per-capability via **BYOK** (bring your own key).

**License: AGPL-3.0-or-later.** It's a *combined work* — several open-source projects bolted
together over **MCP** rather than merged. See `NIGHTJAR_LICENSE_AND_ATTRIBUTION.md`.

| Component | Role | License | How it's included |
|---|---|---|---|
| **OpenCode** | the agent engine — the ONLY agent loop | MIT | git **submodule** at `research/opencode` (pinned to the `AxeH666/opencode` fork), run from TS source via **bun** |
| **Row-Bot** | voice / vision / memory / browser capabilities | Apache-2.0 | vendored into `phase2-mcp/nightjar_capabilities/_vendor/` |
| **Odysseus** | email / RAG / deep-research / calendar / notes / tasks | AGPL-3.0-or-later | **git submodule** at `research/odysseus` + a small integration patch |
| **orb-ui** | the voice-reactive orb | MIT | forked/themed into the UI |

**Core design posture (these are load-bearing):**
- **Offline-first / loopback-only.** The renderer's CSP allows only `127.0.0.1`/`localhost`.
- **In-silico only.** No real-world actuation, no ordering, no egress by default.
- **Permission-gated.** Every mutating tool prompts the user through a global modal.
- **Composition over merging.** Components talk over **MCP** (Model Context Protocol) + a small
  **WebSocket side-channel** (wake-word / transcription / TTS / orb state).

---

## 2. Architecture at a glance

```
┌───────────────────────────────────────────────────────────────────┐
│  Electron app (React + Vite + Tailwind + three.js)  ← the UI      │
│  ├─ Supervisor: launches/adopts/heals every sidecar below         │
│  └─ Renderer: Chat · CAD · LAB · Code tabs                        │
└───────────────┬───────────────────────────────────────────────────┘
                │ HTTP + SSE (127.0.0.1:4096)
┌───────────────▼───────────────────────────────────────────────────┐
│  opencode-serve  (OpenCode engine, run by BUN from TS source)     │
│   • owns the agent loop, tool calls, permissions                  │
│   • SPAWNS every MCP server below (per opencode.json)             │
└───┬───────────────────────────────────────────────────────────────┘
    │ stdio (MCP)
    ├─ cad-build123d      → phase-cad/.venv     (build123d / OCCT)  ⭐ the CAD lab
    ├─ nightjar           → phase2-mcp/venv     (voice/vision/memory/browser)
    ├─ browser-use        → browser-use-mcp/venv
    └─ odysseus-{email,image,rag,research,docs,pim} → phase2-odysseus/venv

  Model layer:  llama-server (:8085, CUDA)  ←  inference-proxy (:8086, bun)
  Side-channel: sidechannel.py (:8765 WS) + wake_daemon.py (:8766)
  Optional:     ollama (:11434, vision) · diffusion-server (:8100, image gen)
```

**The key insight:** the Electron app is the *launcher*. Its **Supervisor** starts each service
in dependency order, **adopts** anything already healthy on its port (instead of double-spawning),
gates on readiness, restarts on crash with backoff, and kills process trees on shutdown.

---

## 3. Repo layout

```
phase1-engine/      local model + inference proxy (bun .mjs) + safety plugins + reports
phase2-mcp/         Row-Bot-derived capabilities MCP + wake daemon + side-channel   (venv)
phase2-odysseus/    Odysseus MCP wrappers + config + THE WORKSPACE (opencode.json)  (venv)
phase-cad/          Prompt-to-CAD: build123d MCP shim + STEP→GLB converter      (.venv, py3.12)
phase3-ui/          Electron + React desktop app (the whole UI + supervisor)    (node_modules)
browser-use-mcp/    autonomous browser MCP                                          (venv)
diffusion-mcp/      local image generation (torch/diffusers)                        (venv)
telegram-scheduler/ always-on Telegram reminder server (separate deployable)
research/opencode/  OpenCode engine — git SUBMODULE (the only agent loop; AxeH666/opencode fork)
research/odysseus/  Odysseus source — git SUBMODULE (AGPL source-availability)
scripts/setup.{sh,ps1}  one-shot setup — setup.sh (Linux/WSL/Git-Bash) · setup.ps1 (native Windows)
```

**Docs you should know about:**
- `README.md` — project overview + Linux/WSL setup
- `CLAUDE.md` — **the build rules** (see §8 — read these before deciding anything)
- `KNOWN_ISSUES.md` — every bug/limitation as an `NJ-*` item
- `JUNE_better.md` — UI redesign spec
- `Lab.md` — LAB design doc (vision/architecture)
- `LAB_IMPLEMENTATION_PLAN.md` — **authoritative** resolved decisions + phased PR plan for LAB
- `WINDOWS_SETUP.md` — Windows install reference + §9 full-native checklist
- `NIGHTJAR_LICENSE_AND_ATTRIBUTION.md` — license reasoning + attribution

---

## 4. Tech stack by layer

### 4.1 Desktop UI — `phase3-ui`
- **Electron 33** (Chromium 130) · **React 18** · **Vite 5** via **electron-vite 2** ·
  **Tailwind 3** · **TypeScript 5.7** · **vitest 2** (tests) · **three.js 0.160** (the CAD/orb
  3D) · **marked** (markdown rendering).
- Scripts: `npm run dev` · `npm run build` · `npm run typecheck` · `npm test`.
- **Renderer CSP** (`renderer/index.html`): `default-src 'self'; connect-src 'self'
  http://127.0.0.1:* http://localhost:* ws://…; style-src 'self' 'unsafe-inline'; script-src
  'self'; media-src 'self' blob:` → **no CDN, no WASM (`wasm-unsafe-eval` absent), no
  `worker-src`, no `img-src`**. Every dependency must be bundled.
- **Context stack** (nested in `App.tsx`): `Connection → Model → Artifact → Sessions →
  Permission`. One OpenCode client + ONE SSE stream, demuxed by `sessionID`.

### 4.2 Agent engine
- **OpenCode**, run by **bun** directly from TypeScript source
  (`research/opencode/packages/opencode/src/index.ts serve --port 4096`).
- Config: `phase2-odysseus/workspace/opencode.json` — defines the **agents** and **MCP servers**.
- Substitutes `{env:VAR}` in config (globally, mid-string) — this is how repo-relative paths work.

### 4.3 Models
- **Local chat:** `llama.cpp` → `llama-server` (CUDA build) serving **Qwen3-4B-Instruct-2507
  Q4_K_M GGUF** on `:8085` (`--jinja -c 8192 --cache-type-k q8_0 -ngl 99 --predict 2048
  --timeout 120`). Fronted by **inference-proxy** (`:8086`, a bun `.mjs`) that adds a hard
  wall-clock abort.
- **Local vision:** **Ollama** + **gemma3:4b** (`:11434`).
- **Local image gen:** **Z-Image-Turbo** via **diffusers** (`:8100`, needs ~6 GB VRAM).
- **Cloud (BYOK, opt-in):** OpenRouter / Fireworks / OpenAI / Anthropic / etc. — encrypted key
  storage + a model switcher + an unmissable "cloud active" banner.

### 4.4 Python backends (each an isolated venv — deliberately)
| Component | Purpose | Notable deps |
|---|---|---|
| **phase-cad** (`.venv`, **Python 3.12 exactly**, via `uv`) | Prompt-to-CAD | `build123d>=0.11,<0.12`, `build123d-mcp==0.3.79`, `cadquery-ocp-novtk` (OCCT/VTK) |
| **phase2-mcp** (`venv`) | voice/vision/memory/browser | `faster-whisper`+`ctranslate2` (STT), `kokoro-onnx`+`phonemizer-fork`+`espeakng-loader` (TTS), `openwakeword` (wake word), `faiss-cpu`+`scikit-learn` (memory), `ollama`, `opencv-python-headless`, `mss`, `playwright`, `av`, `soundfile`, `mcp`, `websockets` |
| **phase2-odysseus** (`venv`) | email/RAG/research/PIM | `chromadb` (**embedded — no Docker**), `fastembed`, `onnxruntime`, `sqlalchemy`, `caldav`+`icalendar`+`recurring-ical-events`, `aiosmtpd`, `pypdf`, `ddgs`/`duckduckgo_search`, `fastapi`+`uvicorn`, `croniter`, `youtube-transcript-api` |
| **browser-use-mcp** (`venv`) | autonomous browser | `browser-use==0.13.3` (drives Chromium over CDP — needs a Chrome/Chromium) |
| **diffusion-mcp** (`venv`) | local image gen | `torch` (install the CUDA wheel for GPU), `diffusers`, `transformers`, `accelerate`, `safetensors` |
| **telegram-scheduler** | always-on reminders (separate deployable) | `fastapi`, `apscheduler`, `aiogram`, `sqlalchemy`, `httpx` |

> **Why separate venvs:** heavy/version-sensitive deps (OCP/VTK, torch, browser-use's SDKs) must
> never destabilize each other. `phase-cad` is pinned to **Python 3.12** because that's the
> widest-tested intersection for build123d + OCP + VTK wheels. **Not 3.13.**

---

## 5. Runtime topology (services + ports, all loopback)

| Service | Runtime | Port | Notes |
|---|---|---|---|
| `llama-server` | llama.cpp (CUDA) | 8085 | local chat model; skip it if using BYOK cloud |
| `inference-proxy` | bun | 8086 | wall-clock-timeout proxy over llama |
| `opencode-serve` | bun | **4096** | the engine; **spawns all MCP servers**; cwd = the workspace |
| `side-channel` | phase2-mcp python | 8765 | wake-word / TTS / orb WebSocket |
| `wake-daemon` | phase2-mcp python | 8766 | "Hey Nightjar" loop (needs a mic) |
| `ollama` | Ollama | 11434 | local vision; **adopted** if already running |
| `diffusion-server` | diffusion-mcp python | 8100 | added only if the venv **and** model exist |
| MCP servers (×9) | per-venv python | — (stdio) | spawned by opencode-serve, not the supervisor |

**Supervisor semantics that matter:**
- **Adopt-don't-double-spawn:** if something already answers a service's health probe, it's
  adopted (not respawned).
- **Readiness-gated, sequential start**, restart-on-crash with backoff, periodic health probes.
- **Env overlay:** `opencodeServeEnv()` (in `index.ts`) is the **authoritative** env for
  opencode-serve — it's applied at startup via `setEnv()` and rebuilt on every restart
  (BYOK/capability changes restart the engine).
- A BYOK key change **restarts opencode-serve** → kills SSE → invalidates session ids → the
  renderer reconnects and rebinds slots.

---

## 6. Agents & the tool surface (`phase2-odysseus/workspace/opencode.json`)

**Agents** (each `mode: "primary"` with an identity prompt): `research`, `websearch`,
`assistant`, `cad`, `coding`.

**Gating is via the `permission` map — never `tools:{x:true}`** (see rule 1). Every agent is
`"*": "deny"` + an explicit allow/ask list. Example — the `cad` agent reaches only **20 of the
38** tools the build123d package registers: 15 read-only `allow` (measure/render_view/validate/
inspect/cross_sections/…) + 5 `ask` (execute/export/import_cad_file/load_part/install_skill);
the other 18 (incl. the destructive `reset`) are **unreachable**.

**MCP servers (9):** `nightjar`, `browser-use`, `odysseus-email` *(disabled)*, `odysseus-image`,
`odysseus-rag`, `odysseus-research`, `odysseus-docs`, `odysseus-pim`, `cad-build123d`.
Each command = that phase's venv python + a thin launcher shim, resolved off `{env:NIGHTJAR_ROOT}`
and `{env:NJ_VENV_PY}` (the cross-platform bit — see §9).

---

## 7. Data, config & keys

- `NIGHTJAR_ROOT` — repo root (the app sets it automatically; export it for manual CLI runs).
- **App data:** `~/.nightjar` (Linux) / `C:\Users\<you>\.nightjar` (Windows) — **separate per OS,
  so a Windows install does not touch WSL data.**
- **Odysseus data:** `~/.nightjar/odysseus` (+ embedded Chroma at `…/chroma`).
- **Workspace** (opencode-serve cwd): `phase2-odysseus/workspace`.
- **BYOK keys:** encrypted, stored **per machine** → they do **not** carry over from WSL to
  Windows; re-add them there.
- Key env overrides: `NIGHTJAR_BUN`, `NIGHTJAR_LLAMA_BIN`, `NIGHTJAR_MODEL_GGUF`,
  `NIGHTJAR_WORKSPACE`, `NIGHTJAR_DIFFUSION_PY`, `NIGHTJAR_IMAGE_MODEL_DIR`,
  `NIGHTJAR_DESIGN_PROFILE`, `NJ_VENV_PY` (set by the app).

---

## 8. The build rules (`CLAUDE.md`) — read before deciding

Each rule encodes a real incident. They override default behavior:

1. **Gate with `permission`, never `tools:{x:true}`** — the tools map compiles to *allow* and
   silently defeats the approval prompt.
2. **Snapshot pre-existing dirty git state before any scope check** — a safety plugin once
   deleted the user's own uncommitted files.
3. **Every long-running model call/subprocess needs its own hard wall-clock timeout** —
   doom-loop detection only catches *finished* repeats, not one call that never returns.
4. **A failed structured edit returns the error — never fall back to a full rewrite.**
5. **Read the actual LICENSE file** — never trust `package.json`/badges (LobeChat and Open WebUI
   both looked permissive and weren't).
6. **Prove a safety fix by re-triggering the real failure** — config that *looks* right can still
   fail at runtime.
7. **Flag new hazards explicitly and separately** — no silent drive-by fixes, no silent ignoring;
   defects in shipped work go to `KNOWN_ISSUES.md` as `NJ-*`.
8. **Verify environment-dependent behavior on the environment it targets — and state what you
   couldn't verify.** Never mark an env-dependent feature "verified" from a proxy.

**Merge workflow:** never commit to main; branch off fresh main; **one PR at a time, no
stacking**; wait for **Cursor BugBot**; fix findings on the same branch (it reviews **once**);
merge when clean; delete branch; pull.

---

## 9. Windows migration — what to watch

### 9.1 What was WSL/Linux-specific and is now FIXED (PR #90, in `main`)
1. **POSIX venv paths → OS-aware.** `opencode.json` MCP commands now use
   `venv/{env:NJ_VENV_PY}`; `services.ts` sets `NJ_VENV_PY` = `bin/python` (POSIX) /
   `Scripts/python.exe` (Windows). **Critically**, `opencodeServeEnv()` in `index.ts` also sets
   it — that function is the authoritative env (it clobbers the service-def env at startup and on
   every restart). Every app-side python spawn (**CAD converter**, task scheduler, image seed)
   now routes through a shared `venvPython()` helper.
2. **POSIX process-group kill → cross-platform.** `supervisor.ts` used
   `process.kill(-pid, SIGTERM/SIGKILL)` (a process-*group* kill; SIGTERM isn't real on Windows).
   Now `killTree`/`killProc` branch to `taskkill /pid <pid> /T [/F]` on Windows. Plus
   `windowsHide` on spawn (no console pop-ups).
3. **Spawn-error guard.** A missing optional binary (e.g. no local llama under BYOK) emitted an
   unhandled `'error'` that could crash startup. Now it's captured → service marked failed → the
   app continues.

### 9.2 What auto-corrects on native Windows (all `isWSL()`-gated in code)
These were WSL problems, not Windows problems — native Windows takes the normal path automatically:
- **Software rendering** (`app.disableHardwareAcceleration()` + SwiftShader) — WSL only. Native
  Windows uses the **real GPU**. *(This is the whole reason for the migration.)*
- **File picker** forced to `/mnt/c/Users` — WSL only; native uses the normal Windows dialog.
- **Clipboard image paste** via a PowerShell read-through (WSL delivers an undecodable BMP) —
  WSL only; native uses the normal DOM clipboard.
- **Drag-drop** browse-instead fallback (Windows→WSL DnD delivers no payload) — WSL only; native
  DnD works.

### 9.3 Live gotchas to expect on Windows
- **`scripts/setup.sh` is bash-only** — do NOT run it natively; use `WINDOWS_SETUP.md` §9's
  PowerShell equivalents. (Git Bash could run it, but it'd build Linux-layout venvs.)
- **Reopen the terminal after every installer** (PATH won't refresh) — the #1 "command not found".
- **`bun` running OpenCode's TypeScript is the least battle-tested piece on Windows** — if
  `opencode-serve` won't start, suspect this first.
- **`phase-cad` needs Python 3.12 exactly** (OCP/VTK wheels). `smoke_test.py` is the gate.
- **Long paths**: `git config --system core.longpaths true`.
- **PowerShell execution policy** may block `irm | iex` installers →
  `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.
- **BYOK keys don't carry over** from WSL (per-machine encrypted storage).
- **llama.cpp**: needs a Windows CUDA `llama-server.exe` (set `NIGHTJAR_LLAMA_BIN`) — or skip it
  entirely and use a **BYOK cloud key** for the first run.
- **Nothing touches WSL**: separate clone, separate `node_modules`/venvs, separate data dir.
  Keep WSL until Windows is confirmed end-to-end.

---

## 10. Where the project stands

**Shipped & merged:**
- **Phases 1–4**: engine + safety harness · capabilities MCP (14 tools) + wake-word · Odysseus
  sidecars (embedded Chroma, no Docker) · UI shell (chat, tool cards, permission modal,
  multi-sidecar supervisor) · voice orb.
- **BYOK** cloud keys (encrypted, model switcher, cloud banner, OpenRouter rate-limit auto-switch).
- **Prompt-to-CAD (Task 5)**: build123d MCP + a trusted STEP→GLB converter + a hero demo.
- **Telegram scheduler (Task 6)**: cost/abuse caps + exposure hardening; 49 offline tests.
  *Owed: one live round-trip (needs a BOT_TOKEN + LLM key).*
- **LAB foundation** (PRs #83–#87): the LAB hub tab + launcher + shared shell (Chats rail ·
  center viewer · tabbed Inspector · bottom prompt), proven with **Mechanical** (reuses the CAD
  stack); per-slot chat history; per-lab **Projects** (store + home grid + editable
  Memory/Instructions/Files).
- **Windows support** (PRs #88/#90/#91): the setup guide + the cross-platform launch fixes +
  the full-native checklist.

**In flight / next:**
- Stand up **native Windows**, verify the LAB foundation on real GPU (`WINDOWS_SETUP.md` §9/§8).
- **PR 5b** — per-project *chat isolation* (`(slot, projectId)` session keying) + Instructions →
  agent injection. **Deliberately deferred**: it touches the fragile, safety-relevant session
  core and could only be *runtime*-verified on a real display (rules 6/8). Build + verify on
  Windows.
- Then the LAB roadmap: **M3** ViewerManager refactor → **M4 Physics** → **M6 Chem** → **M8 Bio**
  → fold the standalone CAD tab into LAB → the dedicated **guardrails session**.

**Deferred by decision:** all content **hazard screens** (chem/physics/bio) go to a dedicated
red-teamed guardrails session; dual-use retrosynthesis runs unscreened in the interim (offline,
single-user, no egress, no ordering) with **public/multi-user release blocked** until the screen
ships. Hard boundaries that are NOT toggles: no weapon/explosive/nuclear-**device** engineering
(§5.8 "simulate the phenomenon, never engineer the device"); no bioweapon/gain-of-function uplift.

---

## 11. Open issues worth knowing (`KNOWN_ISSUES.md`)

- **NJ-32** — local image reading fails on a 6 GB GPU (chat model fills VRAM, vision falls to CPU
  and times out). *Decision pending: cloud vision vs tune VRAM vs cloud-only.*
- **NJ-30** — WSLg isn't a supported interactive GUI env → move GUI testing to native Windows
  *(exactly what we're doing)*.
- **NJ-31** — WSLg GPU-process crash → software rendering forced under WSL (fixed, WSL-only).
- **NJ-26/27/28/29** — file picker / real path / clipboard paste / drag-drop: all WSL artifacts,
  fixed with fallbacks; the **real** paths need native-Windows confirmation.
- **NJ-19** — desktop scheduler DST/tz drift (fixed in the always-on server; deferred on desktop).
- **NJ-22/23** — BYOK model-id drift + no per-provider "pick another model" picker (deferred).
- **NJ-18** — upstream build123d footguns (empty GLB reported as success; STEP tree can't
  re-export) — **mitigated** in our converter (rebuild each leaf; validate the output bytes).
- **NJ-11/B3** — diffusion server lacks a per-generation wall-clock cap (deferred).

---

## 12. Glossary

- **MCP** — Model Context Protocol; how tools are exposed to the agent (here: local stdio servers).
- **opencode-serve** — the OpenCode engine process (HTTP+SSE on 4096); spawns the MCP servers.
- **Slot** — a UI tab's own chat session (`chat` / `code` / `cad`); the single SSE stream is
  demuxed by session id.
- **BYOK** — bring your own key (opt-in cloud).
- **Side-channel** — the WebSocket carrying wake-word/TTS/orb state (not the agent loop).
- **Hero demo** — a pre-authored, known-good build (the planetary gearset) that bypasses the model
  entirely — a reference with no permission prompts.
- **NJ-*** — an entry in `KNOWN_ISSUES.md`.
- **LAB** — the engineering-disciplines hub (Mechanical/Physics · Bio · Chem; Electronics /
  Semiconductors / Architecture are v3-parked).
