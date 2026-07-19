# JUNE / Nightjar — Windows dev environment (install reference)

> **Read this first.** JUNE's launch layer is currently **WSL/Linux-specific** in two ways
> (see [§7 Windows blockers](#7-windows-blockers-native-run-needs-these)): MCP/service
> commands hardcode POSIX venv paths (`venv/bin/python`), and the supervisor kills process
> trees with POSIX `process.kill(-pid)`. **Both are now fixed** (Linux-preserving; §7) — a
> fully-native Windows run is unblocked (the Windows *runtime* is yours to confirm on the box). This doc installs every component and gives you **two wiring
> options** (§6): **(A) hybrid** — backend in WSL2, native-Windows Electron UI (no porting
> needed, fastest to real GPU rendering); **(B) full native** — everything on Windows (needs
> the §7 fixes). Pick after you've seen the pieces.
>
> Everything here is verified against the repo source (`services.ts`, `supervisor.ts`,
> `opencode.json`, `scripts/setup.sh`, `phase-cad/setup.sh`). What is **not** verified is the
> Windows *runtime* — that's yours to confirm on the box (this repo was developed on WSL2).

---

## 1. Component & port map

| Service | Runtime | Port | Purpose | Required for… |
|---|---|---|---|---|
| **llama-server** | `llama.cpp` (CUDA) | 8085 | local LLM (Qwen3-4B GGUF) | local chat (or use BYOK cloud instead) |
| **inference-proxy** | **bun** | 8086 | wall-clock-timeout proxy over llama | local chat |
| **opencode-serve** | **bun** | 4096 | the agent engine (HTTP+SSE); **spawns all MCP servers** | everything |
| **cad-build123d** (MCP) | Python **3.12** venv (`phase-cad/.venv`) | — (stdio) | Prompt-to-CAD (build123d) | **the LAB / CAD lab** |
| nightjar (MCP) | `phase2-mcp/venv` | — (stdio) | voice/vision/memory/browser tools | assistant tools |
| odysseus-* (MCP ×6) | `phase2-odysseus/venv` | — (stdio) | email/RAG/research/docs/PIM | assistant tools |
| browser-use (MCP) | `browser-use-mcp/venv` | — (stdio) | autonomous browser | browser tool |
| side-channel | `phase2-mcp/venv` python | 8765 | wake-word/TTS/orb side-channel | voice orb |
| wake-daemon | `phase2-mcp/venv` python | 8766 | "Hey Nightjar" loop | wake word (needs mic) |
| ollama | Ollama | 11434 | local **vision** (gemma3:4b) | offline image analysis |
| diffusion-server | `diffusion-mcp/venv` (CUDA) | 8100 | local **image gen** (Z-Image-Turbo) | offline image gen |
| Electron UI | Node + electron-vite | — | the app | everything (this is what renders) |

**To verify the merged LAB foundation (Mechanical/CAD), you only need:** the Electron UI +
opencode-serve + a chat model (**local llama OR a BYOK cloud key**) + the **cad-build123d**
MCP (`phase-cad/.venv`). Everything else (voice/vision/email/RAG/diffusion) is optional.

---

## 2. Prerequisites

1. **Git** (with submodules). Clone with the Odysseus submodule:
   ```powershell
   git clone --recurse-submodules https://github.com/AxeH666/nightjar.git
   cd nightjar
   ```
   Already cloned? `git submodule update --init research/odysseus`
2. **NVIDIA driver + CUDA** (only if you want local llama and/or local image gen on GPU).
   The Windows NVIDIA driver also powers CUDA inside WSL2 — no separate WSL driver.
3. Decide **local model vs BYOK**: local llama.cpp is heavier to set up on Windows; a **BYOK
   cloud key** (OpenRouter / Fireworks / OpenAI / Anthropic …) skips llama entirely and is the
   quickest way to a working chat + CAD. You can add local llama later.

---

## 3. Install the components

### 3.1 Node.js + the Electron UI
- Install **Node.js 20 LTS+** (includes npm).
- ```powershell
  cd phase3-ui
  npm install
  ```
- Run (dev): `npm run dev`  ·  typecheck/build/test: `npm run typecheck` / `npm run build` / `npm test`.

### 3.2 Bun (runs the engine + proxy from TS source)
- **Windows:** `powershell -c "irm bun.sh/install.ps1 | iex"` → installs `bun.exe` to `%USERPROFILE%\.bun\bin\`.
- **WSL:** `curl -fsSL https://bun.sh/install | bash` → `~/.bun/bin/bun`.
- `services.ts` defaults to `~/.bun/bin/bun`; on Windows set **`NIGHTJAR_BUN`** to the `bun.exe` path (§5).

### 3.3 Python 3.12 + the backend venvs
Install **Python 3.12** (python.org or `winget install Python.Python.3.12`). 3.12 is mandatory
for phase-cad; use it everywhere for consistency.

- **WSL / Git-Bash:** the one-shot script does the submodule patch + venvs + `npm install`:
  ```bash
  ./scripts/setup.sh          # bash only (WSL, or Git Bash on Windows)
  ```
- **Native Windows (PowerShell):** run the one-shot `powershell -ExecutionPolicy Bypass -File
  scripts\setup.ps1` (the PowerShell equivalent of `setup.sh` — submodules incl. the engine,
  `bun install`, the Odysseus patch, all venvs, the UI). Or do it per backend by hand:
  ```powershell
  # for each of: phase2-mcp, phase2-odysseus, browser-use-mcp
  py -3.12 -m venv phase2-mcp\venv
  .\phase2-mcp\venv\Scripts\python -m pip install --upgrade pip
  .\phase2-mcp\venv\Scripts\python -m pip install -r phase2-mcp\requirements.txt
  # …repeat for phase2-odysseus\ and browser-use-mcp\
  ```
  On Windows the interpreter is **`venv\Scripts\python.exe`** (not `venv/bin/python`) — this is
  exactly what §7 is about.

### 3.4 phase-cad — the CAD lab (Python 3.12 via `uv`)  ⭐ needed for LAB
build123d pulls heavy, version-sensitive OCP/VTK wheels, so it gets a **dedicated Python 3.12
venv via [`uv`](https://docs.astral.sh/uv/)**, kept isolated from the other venvs.
- Install `uv`: **Windows** `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"` · **WSL** `curl -LsSf https://astral.sh/uv/install.sh | sh`.
- **WSL:** `phase-cad/setup.sh` does it. **Native Windows (PowerShell):**
  ```powershell
  cd phase-cad
  uv venv --python 3.12 .venv
  uv pip install --python .venv\Scripts\python `
    "build123d>=0.11,<0.12" "build123d-mcp==0.3.79" "cadquery-ocp-novtk!=7.9.3.1.1"
  .\.venv\Scripts\python smoke_test.py
  cd ..
  ```
- **Required env for the CAD MCP:** `BUILD123D_IN_PROCESS=1` (already set in `opencode.json`;
  the default worker-subprocess mode fails under stdio MCP hosts — upstream #143).

### 3.5 llama.cpp + the Qwen3-4B model  (skip if using BYOK cloud)
- **Model:** download `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` → default location
  `~/models/qwen3-4b-instruct-2507/` (override with **`NIGHTJAR_MODEL_GGUF`**).
- **Binary:**
  - *WSL (works today):* build llama.cpp with CUDA → `~/llama.cpp/build-cuda/bin/llama-server`.
  - *Native Windows:* use a prebuilt **CUDA `llama-server.exe`** (llama.cpp releases) or build with
    CMake+CUDA; set **`NIGHTJAR_LLAMA_BIN`** to it.
- Launch args JUNE uses (FYI, the supervisor sets these): `--jinja -c 8192 --cache-type-k q8_0 -ngl 99 --predict 2048 --timeout 120 --host 127.0.0.1 --port 8085`.

### 3.6 Ollama + gemma3:4b (optional — offline vision)
- Install Ollama (**Windows:** the .exe installer → `%LOCALAPPDATA%\Programs\Ollama\ollama.exe`,
  which `vision.ts` already knows to look for). `ollama pull gemma3:4b` (~3.3 GB).
- Skippable; cloud vision via BYOK works without it.

### 3.7 diffusion / Z-Image-Turbo (optional — offline image gen, heavy CUDA)
- `diffusion-mcp/venv` (torch/diffusers, CUDA) + download `Tongyi-MAI/Z-Image-Turbo` (~6 GB) to
  `~/models/Z-Image-Turbo` (override `NIGHTJAR_IMAGE_MODEL_DIR`). Needs ~6 GB VRAM. The service is
  added only when both the venv and model exist. Skippable (`NIGHTJAR_SKIP_DIFFUSION=1` in the
  bash setup); cloud image gen via BYOK works without it.

### 3.8 Odysseus submodule + patch
`scripts/setup.sh` fetches `research/odysseus` (git submodule) and applies
`phase2-odysseus/odysseus-patches/nightjar-odysseus.patch` (embedded ChromaDB, no Docker). If
you set venvs up manually, still run the submodule init + `git -C research/odysseus apply <patch>`
(or run `scripts/setup.sh` under Git Bash). Only needed for the email/RAG/research/PIM tools — **not**
for the LAB/CAD verification.

---

## 4. Ports (all loopback `127.0.0.1`)

`8085` llama · `8086` inference-proxy · `4096` opencode-serve · `8765` side-channel ·
`8766` wake-daemon · `8100` diffusion · `11434` ollama. The renderer CSP allows only
`127.0.0.1`/`localhost` (loopback) — no other origins.

## 5. Environment variables

| Var | Meaning | Windows note |
|---|---|---|
| `NIGHTJAR_ROOT` | repo root | app sets it automatically; export for manual CLI runs |
| `NIGHTJAR_BUN` | path to `bun` | set to `%USERPROFILE%\.bun\bin\bun.exe` |
| `NIGHTJAR_LLAMA_BIN` | path to `llama-server` | set to your `llama-server.exe` |
| `NIGHTJAR_MODEL_GGUF` | GGUF path | override if not in `~/models/…` |
| `NIGHTJAR_WORKSPACE` | opencode cwd | default `phase2-odysseus/workspace` |
| `NIGHTJAR_DIFFUSION_PY` / `NIGHTJAR_IMAGE_MODEL_DIR` | image backend | Windows venv/model paths |
| `NIGHTJAR_SKIP_OLLAMA` / `NIGHTJAR_SKIP_DIFFUSION` | skip optional models in bash setup | — |
| `NIGHTJAR_DESIGN_PROFILE` | lift local-model output caps | optional |

> The app sets **`NJ_VENV_PY`** (`bin/python` on POSIX, `Scripts/python.exe` on Windows) in the
> opencode-serve env — it resolves the `opencode.json` MCP interpreter paths per-OS (§7). A
> **manual** `opencode serve` run (not via the app) must export it too.

---

## 6. Two wiring options

### Option A — Hybrid: WSL backend + native-Windows UI  (no porting; fastest to GPU rendering)
1. In **WSL2**, run the backend as today: `./scripts/setup.sh` once, then start the stack
   (llama/proxy/opencode-serve + cad MCP). CUDA compute works in WSL2 via the Windows driver.
2. On **native Windows**, run the Electron UI: `cd phase3-ui && npm run dev`. The supervisor
   **adopts** any backend service already healthy on `127.0.0.1:<port>` (WSL2 forwards `localhost`
   to WSL services) instead of spawning it — so the UI renders on the **native Windows GPU** (no
   WSLg) while the backend stays in its working WSL env.
3. **Caveats to confirm on-box:** (a) WSL2 `localhost` forwarding must reach the WSL services from
   the Windows process (enable *mirrored* networking mode if not); (b) start the **full** backend in
   WSL first, so the Windows UI has nothing left to spawn (it can't spawn the POSIX-path services
   natively — they'd just show "failed", harmlessly for the optional ones). Best for verifying the
   LAB foundation quickly; labs' Python MCPs keep running/building in WSL, viewers render natively.

### Option B — Full native Windows  (needs the §7 fixes first)
1. Land the two porting fixes (§7): OS-aware venv paths + Windows process-tree kill.
2. Install the whole stack on Windows (§3, native paths), set the §5 env vars.
3. `cd phase3-ui && npm run dev` — the supervisor spawns everything natively.

**Fastest recommendation:** do **Option A** to get real GPU rendering + verify the LAB foundation
now, then land the §7 fixes and move to **Option B** incrementally.

---

## 7. Windows blockers (native run needs these)

These were the two blockers to a fully-native Windows run. **Both are now fixed** — Linux-preserving
(nothing changes on Linux; typecheck/build/tests green). Only the Windows *runtime* is yours to confirm.

1. **POSIX venv paths.** `opencode.json` (all 9 MCP commands) + `services.ts` (side-channel,
   wake-daemon, diffusion default) hardcoded `venv/bin/python`; on Windows that's
   `venv\Scripts\python.exe`. **Fixed:** `opencode.json` now uses `venv/{env:NJ_VENV_PY}`, and
   `services.ts` sets `NJ_VENV_PY`=`bin/python`/`Scripts/python.exe` by `process.platform` (and
   resolves its own python sidecars + `bun.exe` the same way). On Linux → identical to before.
2. **POSIX process-tree kill.** `supervisor.ts` used `spawn(…, {detached:true})` +
   `process.kill(-pid, …)` (a process-**group** kill; `SIGTERM` isn't real on Windows). **Fixed:**
   `killTree`/`killProc` helpers branch to `taskkill /pid <pid> /T [/F]` on Windows (POSIX path
   unchanged), plus `windowsHide` on spawn. (`pidOnPort` already had a `win32` netstat branch.)

Both are in `main`, so **Option B (full native) is unblocked**. Option A (adopt-in-WSL) also still
works — it never spawns/kills the backend, so it never needed these.

---

## 8. Verify the LAB foundation (once running)

The merged foundation (PRs #83–#87) to eyeball on a real display:
- **LAB tab** appears (Chat · CAD · **LAB** · Code) → launcher shows Mechanical / Bio / Chem cards.
- **Mechanical** opens the shell: left **Chats** rail, center **3D viewer**, right tabbed
  **Inspector** (Structure/Properties/Downloads), bottom **prompt** + **⚙ Load demo**.
- **Load demo** renders the planetary gearset; Structure tab drives explode / isolate / per-part
  visibility / reset (these must agree — the visibility×isolation fix).
- **Projects** (📁 in the rail): create/rename/duplicate/delete/favorite/search/sort; open a
  project → editable **Memory / Instructions / Files** (persist across reopen; delete removes their
  data; duplicate copies it).
- Then: the deferred **PR 5b** (per-project chat isolation) + the net-new labs get built and
  verified here, where the session core + viewers can actually be driven.

---

## 9. Full-native (Option B) first-run checklist

The §7 fixes are in `main`, so a fresh clone runs natively. This is the minimal path to a
GPU-rendered LAB/CAD verification using a **BYOK cloud key** (skip local llama for the first
run). Keep your WSL clone until this passes — safety net.

### 9.0 · Fresh clone (do NOT copy from WSL)
- Enable long paths once (admin PowerShell): `git config --system core.longpaths true`
- Clone to a **short, space-free** path (avoid OneDrive-synced or spaced paths):
  ```powershell
  cd C:\dev
  git clone --recurse-submodules https://github.com/AxeH666/nightjar.git
  cd nightjar
  ```
  `--recurse-submodules` is **required** — it fetches both the Odysseus and the **OpenCode
  engine** (`research/opencode`, the only agent loop) submodules. Without it the engine is
  absent and chat can't start. Already cloned without it? `git submodule update --init`.
- **Why fresh, not copied:** the WSL clone's `node_modules` hold Linux-native binaries
  (Electron/esbuild) and its venvs hold Linux python + Linux OCP/VTK wheels — none run on
  Windows. Fresh clone + fresh installs is mandatory.

### 9.1 · Install (minimal: LAB/CAD via Fireworks BYOK)
First install the four prerequisites (**reopen the terminal after each** so PATH refreshes):
1. **Node 20 LTS+** → `winget install OpenJS.NodeJS.LTS`.
2. **Bun** → `powershell -c "irm bun.sh/install.ps1 | iex"` (→ `%USERPROFILE%\.bun\bin\bun.exe`, found automatically).
3. **Python 3.12** (exactly — not 3.13) → `winget install Python.Python.3.12` (confirm `py -3.12 --version`).
4. **uv** → `powershell -c "irm https://astral.sh/uv/install.ps1 | iex"`.

Then run the setup script — it fetches the submodules (incl. the **OpenCode engine**),
`bun install`s the engine, applies the Odysseus patch, builds the **phase-cad** venv, and
installs the UI's node modules:
```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -CoreOnly
```
- `-CoreOnly` is the minimal LAB/CAD-via-BYOK path (engine + phase-cad + UI). **Drop it** to
  also build the `phase2-mcp` / `phase2-odysseus` / `browser-use` venvs and (best-effort)
  Ollama + the diffusion backend: `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1`.
- The engine `bun install` may print a `tree-sitter-powershell` postinstall error — **harmless**
  (a TUI-only grammar; the script auto-retries `--ignore-scripts`, which the HTTP `serve` path
  doesn't need).
- OCP/VTK are big Windows wheels (slow but present). If one fails: confirm Python **3.12 exactly**
  (not 3.13) + a recent `uv`. `smoke_test.py` is the gate — setup stops if it fails.

⚠️ *Bun running OpenCode's TS is the least-tested piece on Windows. If `opencode-serve` won't
start, the app now surfaces a clear "engine source missing — run setup" failure (rather than an
opaque crash-loop); re-run `setup.ps1` and check that service's log in the app.*

**Skip for now** (add after the core works): local `llama.cpp` (using BYOK instead), Ollama, and
the diffusion image backend.

### 9.2 · Run (native — no WSL workarounds)
```powershell
cd phase3-ui
npm run dev
```
- The app **is** the launcher: its supervisor spawns `opencode-serve` (bun) → which spawns the
  CAD MCP (`phase-cad\.venv\Scripts\python.exe`, resolved via `NJ_VENV_PY`).
- **No env vars needed** if bun is at its default path (the app auto-sets `NIGHTJAR_ROOT` +
  `NJ_VENV_PY`). Set `NIGHTJAR_BUN` only if bun is elsewhere.
- **No `LIBGL_ALWAYS_SOFTWARE` / SwiftShader** — the software-GL path is `isWSL()`-gated, so
  native Windows uses the **real GPU** automatically.
- Under BYOK, `llama-server`/`inference-proxy` show **failed/unhealthy** — expected and harmless
  (the spawn-error guard keeps startup going).

### 9.3 · Fireworks BYOK (skip llama)
In the running app → **Manage keys / Settings** → add your **Fireworks** key → pick the Fireworks
model in the switcher (the "cloud active" banner appears). Chat + CAD then run via the cloud model
— no local llama. *(Add local llama later: a CUDA `llama-server.exe` + the GGUF, then
`NIGHTJAR_LLAMA_BIN` + `NIGHTJAR_MODEL_GGUF`.)*

### 9.4 · Verify (§8 above, on real GPU)
Walk the §8 checklist. In addition, confirm the previously-WSL-broken things now work natively
(all `isWSL()`-gated in code): **drag-drop** a file onto the chat · **Ctrl+V** an image ·
**file picker** opens at a normal Windows path (not `/mnt/c`) · a **desktop notification** fires ·
the 3D viewer is smooth (**GPU**, not SwiftShader). Prompt a real part ("a bracket with two M4
holes") to exercise the CAD MCP python via the `NJ_VENV_PY` fix.

**PR 5b:** it was *deferred, never built* (it needed on-device verification) — once the above is
green, per-project chat isolation gets **built** on Windows and verified there for the first time.
