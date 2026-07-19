# audit1.md — Nightjar / JUNE: strict pre-resume audit + cleanup plan

> **Purpose.** A strict, read-only audit of *everything built so far*, run before resuming the
> build (at LAB **PR-5b**), to make what exists **smooth, accurate, and effective** on the new
> **native-Windows** target. Requested outcome: no partial features masquerading as done; every
> real defect named; a concrete cleanup plan.
>
> **Date:** 2026-07-19 · **Auditor:** Claude Code (Opus 4.8) · **Branch:** `main` @ `a8d1177`
> **Target runtime:** native **Windows 11** (win32), migrated from a WSL2 dev box.
> **Scope:** Nightjar-**authored** code + config + patches + integration seams **only** — vendored
> upstream (`research/opencode`, `research/odysseus` internals, `_vendor/row_bot`, `node_modules`,
> venv site-packages) is out of scope except where Nightjar depends on or patches it.
>
> **Method:** an 11-finder multi-agent sweep across 5 lenses → each finding adversarially
> re-verified against source → 3 supplemental deep-dive finders → plus a **live** root-cause
> confirmation on this Windows box. **No files were edited.** (Two on-disk, git-ignored side
> effects from the live check are disclosed in §8.)
>
> **Verification honesty (CLAUDE.md rules 6 & 8):** findings marked *static* were confirmed by
> reading source on this box but **not** driven end-to-end at runtime (the engine + 4 of 5 venvs
> are not installed here — see §3). Findings marked *live* were actually exercised. Every
> Windows-dependent fix in §6 lists what still needs a real native-Windows re-trigger.

---

> **Post-audit update (2026-07-19, after this report was written).** The Pile-1 setup-reproducibility
> work has since landed: **PR #93** (OpenCode engine as a pinned git submodule via the durable
> `AxeH666/opencode` fork), **PR #94** (missing-engine `preflight` → an actionable error instead of a
> crash-loop), **PR #95** (OS-aware `setup.sh` + a new `setup.ps1` + engine `bun install` + the
> Odysseus patch-apply + `.gitattributes` LF guard), and **PR #96** (**NJ-34**). Live-driving the
> engine during this work **supersedes the §2 "engine start NOT fully closed" row**: a clean
> `bun install` completes and `opencode-serve` boots, binds `:4096`, and serves all four Nightjar
> agents on native Windows — the earlier `ConnectionRefused` was a transient network blip. It also
> surfaced **NJ-34**, the *real* Windows chat-blocker: `NIGHTJAR_ROOT`/`HOME` were passed to the
> engine as backslash Windows paths, which OpenCode splices into `opencode.json` string values →
> invalid JSON escapes → config parse fails → `/agent` 400 → chat dead; fixed by forward-slashing
> those env vars (PR #96, verified live: backslash → 400, forward-slash → 200 with all agents). A
> fresh Windows clone + `setup.ps1` + a BYOK key now reaches working chat. Pile 2 (§4 P1–P3) is
> still open pending your go-ahead.

## 0. TL;DR

**The chat is dead for one dominant reason, and it is not a code bug: the OpenCode agent engine
(`research/opencode`) — "the only agent loop" — is missing on this box, and *no committed script
or doc ever obtains it.*** It is git-ignored, is **not** a submodule, and `scripts/setup.sh` never
clones it. A fresh Windows clone therefore has no engine, so `opencode-serve` crash-loops
(`opencode-serve ⚡5` in your screenshot) and the UI sits on *"Connecting to the engine…"* forever.
I recovered the exact version from your WSL pin — **`github.com/sst/opencode` @ `7a8e7c88`** — and
confirmed it live.

**Two piles, kept strictly separate throughout this report:**

1. **Setup-incompleteness (why it *looks* broken) — §3.** This box is missing the engine, 4 of 5
   Python venvs, and the Odysseus patch. Most "nothing works" is *unfinished Windows setup*, not
   defective code. Fixable by completing setup — **but** the setup *path itself* is broken on
   Windows (see below), so it isn't just "run the installer."

2. **Genuine defects (why it won't be smooth even once set up) — §4.** A real cluster of
   **native-Windows portability bugs** (HOME not injected, `git-gate` reverting the coding agent's
   own edits, wake daemon crashing, `python3`/`bin/python`/`.exe` path assumptions), several
   **missing wall-clock timeouts** (rule 3), a few **UX/observability dead-ends** (non-dismissible
   banners, unviewable sidecar logs, an "engine failed" state that never appears), and **partial
   features** (per-project isolation is a stub — exactly the PR-5→5b boundary).

**Readiness verdict:** **Not yet** smooth/accurate/effective. Nothing here is fatal — the
architecture is sound and a lot is genuinely correct (§5) — but ~10 items must land before the
build resumes. The single highest-leverage action is **§6 Phase 0** (make the engine + Windows
setup reproducible); it unblocks everything else.

**Counts:** 2 × P0 · 6 × P1 · ~24 × P2 · ~30 × P3 (deduped across all finders; 0 findings were
rejected on verification).

---

## 1. What "smooth, accurate, effective" requires here

You asked for three things before building more. Mapping them to the findings:

- **Smooth** = it starts and runs on native Windows without silent failures → blocked today by the
  engine gap (§3, P0), the Windows path bugs (§4 P1s), and the invisible-failure UX (§4: no log
  surfacing, no terminal engine state, silently-disabled scheduler/image).
- **Accurate** = features do what they claim, no false greens → blocked by the partial/stub
  features honestly labeled but not done (per-project isolation, offline image, wake phrase), the
  monthly-reminder + DST bugs, and the doc drift that misdescribes reality.
- **Effective** = the safety/permission system and the agent loop actually hold → mostly **good**
  (§5), with real gaps: `git-gate` mis-firing on Windows, `doom-loop` over-blocking, two mutating
  tools set to `allow` instead of `ask`, and several unbounded model/subprocess calls.

---

## 2. Live confirmation on native Windows (this box)

Per rules 6/8, I did not reason from config alone — I recovered the engine and exercised the real
paths I could.

| Check | Result | Evidence |
|---|---|---|
| **Root cause of dead chat** | ✅ **CONFIRMED** | `research/opencode` absent; git-ignored (`.gitignore:96`), not a submodule, cloned by no script. `services.ts:27,117` runs it via bun. |
| **Engine version to recover** | ✅ **Identified** | WSL clone `/home/axehe/nightjar/research/opencode` → `sst/opencode` @ `7a8e7c88` (branch `dev`); WSL repo HEAD `a8d1177` == this Windows checkout, so config/plugins match that engine. |
| **Does the engine start under bun on native Windows once present?** | ⚠️ **NOT fully closed** | Recovered the source + ran `bun install`; it is **not turnkey**: the `tree-sitter-powershell` postinstall aborts (`'bun' is not recognized` — bun not on PATH), leaving an incomplete tree, and `opencode-serve` then crashed immediately on `Cannot find package 'extend-shallow'`. A clean reinstall was initially **blocked by a transient npm-registry connection failure** ("Failed to install 918 packages" — `ConnectionRefused`); a **later clean `bun install` succeeded and the engine booted + served all four Nightjar agents** (see the post-audit update at the top). Windows engine bring-up needs a good network + a careful install (the `--ignore-scripts` retry now in `setup.ps1`). | 
| **CAD / Mechanical backend on native Windows** | ✅ **WORKS (live)** | `phase-cad/.venv\Scripts\python smoke_test.py` passes: build123d import → 2-part STEP assembly → NJ-18 STEP→GLB converter → valid GLB (`nodes=['assembly','sun_gear','planet_gear_1']`, `meshes=2`). |
| **BYOK key present on this box?** | ❌ No | `%APPDATA%\nightjar-ui\byok-keys.json` does not exist — the Fireworks selection in your screenshot did not persist. A live chat *round-trip* needs a key (or local llama) regardless of the engine. |

**Net:** the P0 root cause is proven; the CAD backend is proven working natively; the "engine
starts clean on Windows" step is the one thing I could not finish here, purely due to network — and
that friction is itself a finding (§4, P1-5 / NJ candidate).

---

## 3. Setup-incompleteness on this box (state, not code defects)

These are why the app *appears* broken. They are fixed by **completing setup**, not by changing
product code — but note §4 shows the setup *path* is itself broken on Windows, so this is not a
one-command fix yet.

| Missing on this box | Consequence | Restore |
|---|---|---|
| **`research/opencode` (the engine)** | `opencode-serve` can't start → chat, all MCP tools, CAD/LAB all dead. | Clone `sst/opencode` @ `7a8e7c88` into `research/opencode`, then `bun install` there (bun on PATH). *(Already done on this box by me — see §8.)* |
| **`phase2-mcp/venv`** | side-channel (:8765) + wake-daemon (:8766) ENOENT → red in health strip; voice/vision/memory/wake dead; **auto-recall** (long-term memory injection) silently off. | `py -3.12 -m venv phase2-mcp\venv` + `pip install -r phase2-mcp\requirements.txt`. |
| **`phase2-odysseus/venv`** | all 6 `odysseus-*` MCPs + the reminder poller + image-endpoint seed dead; desktop scheduler self-disables. | Same pattern for `phase2-odysseus`. |
| **Odysseus patch UNAPPLIED** | Even with the venv, `odysseus-docs`/`odysseus-rag` fail: without the patch's `chroma_client` hunk, `CHROMADB_PERSIST_DIR` is ignored and Odysseus tries a Docker Chroma at `localhost:8100`. | `git -C research/odysseus apply phase2-odysseus/odysseus-patches/nightjar-odysseus.patch` (verified: applies cleanly to the pinned submodule `5acd0ce`). |
| **`browser-use-mcp/venv`, `diffusion-mcp/venv`** | browser tool + offline image gen unavailable. | Per-venv pip install (no scripted Windows path exists — see P1-5). |
| **No persisted BYOK key** | Cloud chat/CAD won't work until a key is re-added (keys are per-machine, don't carry from WSL). | Re-add in the app after the engine is up. |

**Installed & healthy here:** `phase3-ui/node_modules` (real Windows Electron), `phase-cad/.venv`
(Windows layout, smoke-test green), `bun` (`~/.bun/bin/bun.exe`), Node 22, the `odysseus` submodule.

---

## 4. Strict findings

Grouped by severity. Every location is `file:line` I (or a verifier) actually read. **Kind** tags:
`repro-gap`, `cross-platform`, `safety-gate`, `code-defect`, `partial-or-stub`, `ux`, `perf`,
`config-drift`, `doc-drift`, `dead-code`, `licensing`. `[NJ-xx]` = matches a tracked known issue.

### 4.1 — P0 (blocks core function)

**P0-1 · The OpenCode engine is obtained by no committed script or doc → dead engine on any fresh clone** · `repro-gap`
`services.ts:27,115-126` · `scripts/setup.sh:18-20` · `.gitignore:96-97` · `WINDOWS_SETUP.md:229-236`
`research/opencode` is git-ignored, is **not** a submodule (`.gitmodules` lists only `odysseus`), and
`setup.sh` only inits the odysseus submodule — nothing ever clones the engine or runs `bun install`
in it (~4674 pkgs). It is the entire agent loop. On the WSL box it survived as an old manual clone;
the migrated Windows box has nothing. **This is the headline cause of the dead chat.**
**Fix:** make it reproducible — either (a) a **pinned git submodule** at `7a8e7c88`, or (b) an explicit
**scripted clone at that commit + `bun install`** in `setup.sh` *and* a Windows equivalent; plus a doc
fix (§4.2 P1-5) and a preflight (P0-2). See §7 Decision 1.

**P0-2 · Missing engine surfaces as an opaque crash-loop, not an actionable error (no `existsSync` preflight)** · `setup-gap`
`services.ts:27,114-126` · `supervisor.ts:216-235`
Because `bun.exe` exists, spawn "succeeds," then bun exits non-zero (entry file absent). The
supervisor retries 5× with backoff (~30s) → `failed: "exited (code N); restarts exhausted"` — which
never names the missing engine. Contrast `diffusion-server`, which *is* guarded by
`existsSync(DIFFUSION_PY)` (`services.ts:169`). **Fix:** add `existsSync(OPENCODE_ENTRY)` (via a
`ServiceDef.preflight?()` hook so the service can be marked `failed` with a real message *before*
spawn, rather than excluded — excluding it would make chat vanish with no failed dot). Actionable
detail: *"OpenCode engine source not found at … — run setup."* Pairs with P0-1 (the guard improves
the message; the clone restores function — both needed).

### 4.2 — P1 (major feature broken or unverifiable on Windows)

**P1-1 · `opencodeServeEnv()` never injects `HOME`, but every MCP keys its data dirs off `{env:HOME}` → data-dir divergence on Windows** · `cross-platform`
`index.ts:44-49,59-60,303-304` · `phase2-odysseus/workspace/opencode.json:112,119,126,133,140,147,154,161`
8 MCP env blocks resolve `NIGHTJAR_DATA_DIR`/`ODYSSEUS_DATA_DIR`/`CHROMADB_PERSIST_DIR` as
`{env:HOME}/.nightjar/…`, but `HOME` is **not** a standard Windows var (Node uses `USERPROFILE`).
The main process computes the same paths from `os.homedir()`. So on native Windows `{env:HOME}` is
empty (Explorer/PowerShell launch) or a POSIX `/c/Users/…` path (Git Bash) that Windows Python
mis-resolves — MCP data (generated images, Chroma, memory) lands somewhere different from what the
main process reads back. **Fix:** set `HOME: homedir()` (+`USERPROFILE`) in `opencodeServeEnv()`, or
better, export explicit `NIGHTJAR_DATA_DIR`/`ODYSSEUS_DATA_DIR` and reference those in
`opencode.json` (single-sourced, removes the ambiguous `HOME` from the path). Verify natively.

**P1-2 · The "Hey Nightjar" wake/voice daemon is PulseAudio-only (`parec`/`paplay`) → hard-crashes on native Windows** · `cross-platform`
`wake_daemon.py:93,337,375` · `services.ts:135`
`MicStream._start()` shells out to `parec` unconditionally; there is no `platform`/`isWSL` branch and
no visible fallback (violates rule 8). On Windows `Popen(['parec',…])` raises `FileNotFoundError` and
the daemon dies. Worse, the health server binds `:8766` *before* the mic stream starts, so the
supervisor's `tcpOpen` probe can flash green just before it dies (false-green). It's best-effort/last
in start order so the app still boots, but the whole voice feature the orb UI was built for is dead
on the target OS. **Fix:** branch on win32 (capture via `ffmpeg -f dshow`, consistent with the file's
"no pyaudio" stance; route TTS through the Electron UI), and degrade to a visible *"voice unavailable
on this platform"* status instead of crashing.

**P1-3 · `git-gate` reverts the coding agent's OWN edits to any file in a subdirectory on Windows (path-separator mismatch)** · `safety-gate` / `cross-platform`
`nightjar-git-gate.ts:119,130,90,138`
`intendedRel` is built with `relative(root, p)` → **backslash** paths on win32 (`preview\index.html`),
but the dirty set from `git status --porcelain` is always **forward-slash** (`preview/index.html`).
The out-of-scope filter `!intendedRel.has(f.path)` never matches a subdir file, so the agent's own
just-written file is judged out-of-scope and rolled back via `git checkout`/`git clean`. This makes
the coding agent **unusable on Windows for the exact multi-file `preview/` workflow its own system
prompt mandates.** Root-level files match (no separator), which is why `verify-plugins.ts` (top-level
targets only) is a false green. **Fix:** normalize both sides (`.split(path.sep).join('/')` or
`path.posix`); add `-uall` to the porcelain call so new subdirs list individual files (else `git`
collapses to `preview/` and still mis-matches on *all* platforms); add a subdir case to the test.
Re-trigger a real subdir edit natively before calling it fixed.

**P1-4 · Core sidecar paths in `services.ts` are Linux-shaped → local chat can't start on native Windows** · `cross-platform`
`services.ts:28-29,14`
`LLAMA_BIN` defaults to `~/llama.cpp/build-cuda/bin/llama-server` — a Linux CMake layout with **no
`.exe`** — while the adjacent `BUN` const *does* branch on `IS_WIN`. A native Windows CUDA build emits
`build\bin\Release\llama-server.exe`, so the default ENOENTs and **local (offline, default) chat is
unavailable** unless the user knows to set `NIGHTJAR_LLAMA_BIN`. (The `side-channel`/`wake-daemon`
`phase2-mcp/venv` paths are correct `Scripts/python.exe` — they fail only because the venv is absent,
§3.) **Fix:** branch the `LLAMA_BIN` default on `IS_WIN` (append `.exe`, Windows build path), or make
`NIGHTJAR_LLAMA_BIN` a documented hard requirement on Windows and surface the ENOENT clearly.

**P1-5 · The documented Windows setup path does not actually produce a working app** · `doc-drift` / `cross-platform`
`WINDOWS_SETUP.md:223-289` · `scripts/setup.sh:11,43-72` · `README.md:71-74`
Two compounding defects: (a) **`WINDOWS_SETUP.md` §9** ("a fresh clone runs natively") never clones
the engine — following §9.0–§9.3 literally leaves `research/opencode` absent, so §9.4 can never be
reached; §9.1's *"if opencode-serve won't start, suspect bun first"* actively misdirects. (b)
**`scripts/setup.sh` is POSIX-only**: `make_venv` tests `-x venv/bin/python` and calls `venv/bin/pip`,
so under Git Bash on Windows it fails and `set -e` aborts, leaving empty venvs; `phase-cad/setup.sh`
uses `.venv/bin/python` too; `browser-use-mcp`/`diffusion-mcp` have **no** setup script at all. There
is **no working automated Windows setup**. **Fix:** add an engine-fetch step (pinned) to §9 *and*
`setup.sh`; make `make_venv` OS-aware or ship `setup.ps1`; add venv-create steps for
phase-cad/browser-use/diffusion; correct the README "one-shot" claim to enumerate what it does/doesn't
provision.

**P1-6 · `phase2-odysseus` cannot run until BOTH the venv is built AND the patch is applied** · `setup-gap`
`odysseus-patches/nightjar-odysseus.patch` · `PHASE2B_REPORT.md:11`
Distinct from §3's "venv missing": even after the venv, the **unapplied patch** means the
"non-negotiable" embedded-Chroma (no-Docker) requirement, the docs `document`-key fix, and the
image-endpoint fixes are all absent — RAG/docs fail at runtime. Both halves are required together.
**Fix:** document + script the patch-apply as part of Windows setup (it applies cleanly to the pinned
submodule); re-verify docs/rag by driving the real tool, not inspecting config.

### 4.3 — P2 (degraded, partial, or unverifiable-on-Windows)

**Missing wall-clock timeouts (rule 3) — a cluster:**
- **P2-1 · `runImageSeed()` spawns with no timeout → can wedge BYOK/capability IPC.** `index.ts:73-87,145-207,507-557`. If `seed_image_endpoint.py` blocks (SQLite/app-key lock — likelier on Windows's mandatory file locks), `reconcileImageEndpoint` never resolves; `byok:set/remove` + `capabilities:set*` all await it → **Save-key / capability toggles hang forever**. Every sibling spawn (`cad.ts`, `scheduler.ts`, clipboard) *does* cap. Latent now (venv absent). **Fix:** add `timeout+killSignal+windowsHide`, mirror `cad.ts`.
- **P2-2 · Local Ollama vision has no timeout [NJ-32].** `vision.py:96,131` (Nightjar bounded only its *cloud* path; the local path → vendored `client.chat(keep_alive='5m')`, unbounded). On a 6 GB GPU `gemma3:4b` runs on CPU for minutes → reads as a hang. **Fix:** run local analyze in a worker-thread `join(NIGHTJAR_VISION_TIMEOUT_S)`; return a clear "free VRAM / switch to Online" message.
- **P2-3 · `docs_query.document_search` has no timeout.** `docs_query_server.py:20-31` (its two sibling research tools do). A wedged Ollama embedding stalls the tool. **Fix:** wrap in `asyncio.wait_for`, degrade-don't-raise.
- **P2-4 · Diffusion server has no per-generation cap + unbounded `n`/`size`/`steps` [NJ-11/B3, tracked open].** `diffusion_server.py:478,502,484-488` (upstream tree — fix via `odysseus-patches`, **not** by editing the mirror). Must be a **thread**-based abort (not `signal.alarm`, POSIX-only). **Fix:** `--gen-timeout` + clamp `n≤4`, size to a sane max.
- **P2-5 · `promptAsync` + `replyPermission` lack a timeout [NJ-20].** `opencode.ts:144,155`. The NJ-20 fix added `AbortSignal.timeout` to `listAgents/createSession/abort/subscribe` but **not** to the two most safety-relevant POSTs — a half-open socket leaves `busy` stuck and a permission ask removed-from-UI-but-paused-server-side. Rarer on Windows loopback than WSL2/NAT, but the guarantee is simply absent. **Fix:** add `PROMPT_TIMEOUT_MS`/`REPLY_TIMEOUT_MS`; also cover `getMessages`.

**Startup / observability:**
- **P2-6 · Captured sidecar stdout/stderr is never surfaced to the renderer.** `supervisor.ts:196-199,464-466` · `index.ts:294-296`. Every service captures 200 log lines and `Supervisor.logs(name)` exists, but **no IPC ever calls it** (the `nightjar:restart` handler is a documented no-op stub). On Windows first-run, many sidecars fail (missing engine/venvs) and all present identically as a red "failed" dot with only a tooltip — **no path to diagnosis.** This is the single biggest "smoothness" multiplier: it turns P0-2's opaque failure into a readable one. **Fix:** add `ipcMain.handle('nightjar:serviceLogs', …)` + a health-strip log viewer.
- **P2-7 · `HealthStrip` is display-only — no remediation.** `HealthStrip.tsx:20-34` · `preload/index.ts:37` exposes `restartService` but the strip never calls it. Failed dots can't be retried or explained in-app. **Fix:** click-to-`restartService` on failed/unhealthy dots; inline the `detail` (e.g. "venv missing").
- **P2-8 · Connect retry loop has no terminal "engine failed" state → waits forever.** `ConnectionContext.tsx:118,164,170`. When the engine never comes up (the P0 today), `listAgents()` throws every 2s and the status pins to *"still starting the local engine… (a minute on first launch)"* **permanently** — you're told to keep waiting for an engine that will never arrive. **Fix:** after ~90s of continuous failure, surface a distinct *"engine hasn't come up — it may be missing/crashed; see Health/logs"* state (cross-reference the supervisor `ServiceStatus`), while still retrying.
- **P2-9 · Sequential readiness gating lets one slow-but-alive service freeze the whole bring-up.** `supervisor.ts:166-167,237-248`. `start()` awaits each service in array order; `llama-server`'s 120s cold-load window is charged to `opencode-serve`'s start latency even though it has no hard dependency. First-run health strip can look frozen ~2 min. **Fix:** start independent services concurrently, gate readiness in parallel; keep genuine deps (proxy→llama) individually gated.

**Windows path assumptions (beyond P1s):**
- **P2-10 · `hw-detect.mjs` + `nightjar-hwcheck.ts` invoke `python3`** (often absent on Windows → the startup hardware-fit report fails). `hw-detect.mjs:15` · `nightjar-hwcheck.ts:21`. The live plugin has the same bug. **Fix:** resolve OS-aware (`py -3`/`python`); add a timeout (it's awaited in plugin init → a stall delays startup).
- **P2-11 · `nightjar-auto-recall` hardcodes `venv/bin/python` (Windows-broken) + unbounded subprocess per message.** `nightjar-auto-recall.ts:17,33`. Long-term-memory recall silently never fires on Windows (spawn throws → catch → no-op); and it runs on **every** user message with no timeout (a Chroma/cold-model stall wedges the chat turn). **Fix:** use `NJ_VENV_PY` resolution; add a few-second timeout; log once instead of silent no-op.

**Safety-gate correctness:**
- **P2-12 · `doom-loop` strict counter is non-consecutive and never resets → hard-blocks legitimate repeated reads.** `nightjar-doom-loop.ts:22,37,47`. After any `(tool,args)` pair occurs 3× *anywhere* in a session (even interleaved, even read-only `read`/`grep`/`list`), it throws on that call **and every later identical call, permanently**, and the per-session Map leaks. **Fix:** count *consecutive* identical calls (reset on a different call), exclude read-only tools, evict per-session state on end.
- **P2-13 · Assistant agent grants mutating PIM/memory tools as `allow`, not `ask`.** `phase2-odysseus/workspace/opencode.json:59-63`. `pim_note_create`, `pim_task_create`, `pim_calendar_create_event`, `save_memory` write user data with **no approval prompt**. Mechanically rule-1-compliant (uses the `permission` map, not `tools:{x:true}`), but against rule 1's *intent* that mutations prompt. **Fix:** move at least `calendar_create_event` (most consequential) to `ask`, or explicitly document the auto-approve decision. See §7 Decision 4.

**UX / privacy affordances (your explicit asks):**
- **P2-14 · Both cloud banners are non-dismissible.** `CloudBanner.tsx:7-26` · `CapabilityCloudBanner.tsx:25-37` · `AppShell.tsx:77-78`. Neither takes `onDismiss`; `CapabilityCloudBanner` has *no* interactive control at all. **Fix (privacy-honest):** add ✕ + dismissed state in `AppShell`, **keyed to the current cloud target so it re-arms on any change** (`CloudBanner` on `model.id`; `CapabilityCloudBanner` on a signature of the online rows). Keep `ModelSwitcher`'s persistent red border as the always-on indicator so a dismiss never leaves zero cloud signal. (Rule 7: making privacy banners dismissible is a safety-surface reduction — the re-arm + persistent-border pairing is what keeps it honest.)
- **P2-15 · "Switch to local" on `CloudBanner` only switches *chat* — image/vision/research/browser stay on cloud.** `AppShell.tsx:77` · `globalMode.ts:91-125`. The chat banner vanishes and the user reasonably believes "I'm private now," while other capabilities still egress. **Fix:** either relabel "Switch chat to local," or (preferred) run the full `applyGlobalMode({kind:'local'})` so all capabilities flip together (mirror `CapabilitiesSettings.goLocal`).

**Rendering robustness (CAD/LAB on real GPU — never verified natively):**
- **P2-16 · `createCadScene` has no WebGL-init guard/fallback (unlike the orb) → crash or silent blank on a GL-less/software/marginal GPU.** `cadScene.ts:61` · `useCadScene.ts:36` · `CadViewer.tsx:19` vs the orb's guarded `createOrbScene.ts:19-40`. `new THREE.WebGLRenderer()` isn't try/caught and the context isn't validated; on failure it either throws out of the mount effect (white-screens the subtree, no error boundary) or renders a permanent blank while the Inspector lists parts. Violates rule 8. **Fix:** try/catch + validate `getContext()`/`isContextLost()`, return null, show a visible *"3D preview unavailable (no WebGL)"* fallback + a `webglcontextlost` listener, as the orb does.
- **P2-17 · CAD three.js renders at full-rate rAF even when its tab is hidden or empty; up to two live WebGL contexts on the ~6 GB box.** `cadScene.ts:102,107` · `AppShell.tsx:128` (tabs stay mounted, CSS-hidden). Continuous GPU/CPU/battery burn from launch; entering LAB→Mechanical spins a **second** renderer on the same model. The orb already solves exactly this (pause on `document.hidden`, 30 fps cap, unmount at idle). **Fix:** gate `render` on `document.hidden`/zero client-size, render on-demand (OrbitControls `change` + explode/load), cap fps; M-CADfold removes the duplicate later.

**Voice pipeline safety (latent until voice runs):**
- **P2-18 · Voice "speaking" state has no wall-clock timeout, and the full-screen `VortexOverlay` captures all input with no manual dismiss → a hung TTS clip can lock the whole app.** `orbAdapter.ts:219,280` · `VortexOverlay.tsx:52`. `listening`(15s)/`connecting`(30s) auto-revert but `speaking` relies solely on `audio.onended`/`onerror`; if those never fire, the z-40 overlay blocks everything (only a permission modal can surface). **Fix:** bounded speaking-state timer that forces `endTts('idle')`; add a click/✕-to-dismiss escape on the overlay.

**Completeness (the PR-5 boundary):**
- **P2-19 · Per-project isolation is a stub — Projects store + Memory/Instructions/Files persist but are consumed by nothing.** `ProjectView.tsx:31,55` · `MechanicalLab.tsx:84` · `projectContent.ts:5` · `projects.ts:7`. Opening a project shows three note panels, **no scoped chat**; the workspace chat stays the shared `cad` slot; **Instructions never reach any agent** and no send is keyed by `projectId`. This is exactly the built(PR-5)/deferred(PR-5b) line, and it's honestly labeled in-UI ("wired in the next step") — so *disclosed-partial*, not hidden — but **as shipped, per-project isolation does not exist.** This is your resume point. **Fix (this is 5b, not a bug):** key sessions `(slot, projectId)`; give `ProjectView` a scoped `ChatSurface`; prepend project Instructions to the lab agent prompt (rule-1 watch: read per-project Files through the gated read path).

**Scheduler / image visibility on Windows:**
- **P2-20 · Free-tier desktop reminders silently disabled on a fresh Windows box (console.warn only, zero UI signal).** `scheduler.ts:27-32,84-101` · `index.ts:620-624`. `startLocalScheduler()` early-returns when the odysseus venv (or `Notification.isSupported()`) is missing, warning only to a console the user never sees. Combined with NJ-16 (`task_create` cheerfully returns success), a user is told "reminder set" and nothing ever fires. **Fix:** push a scheduler status to the renderer (mirror the vision-status push) → *"reminders unavailable — finish setup"*; make the creation confirmation reflect availability. *(NB: NJ-17 — "no daemon" — is now actually implemented: `scheduler.ts` polls `task_poller.py` every 60s and shows a `Notification`; it just needs the venv.)*
- **P2-21 · Recurring reminders drift ±1h across DST and can fire on the UTC weekday [NJ-19].** `schedule_backend.py:45,54-73` · `nl_intent.py:99-108`. Only a UTC `HH:MM` is stored; the IANA tz is dropped, so recurrence can't re-anchor to local wall-clock after an offset change. OS-independent. **Fix:** persist the tz and compute recurring `next_run` in local time per occurrence, mirroring the always-on server. See §7 Decision 5.

**Licensing / docs (distribution readiness):**
- **P2-22 · No top-level `LICENSE`/`COPYING` — the AGPL-3.0 text is not shipped with the repo.** `README.md:8-11` · `phase3-ui/package.json:5`. Declared AGPL-3.0-or-later everywhere, but the verbatim license text exists only inside the vendored odysseus submodule (upstream), not as a repo file. AGPLv3 §4/§5 require conveying the license with the work; an SPDX id in metadata doesn't satisfy that. **Fix:** add the GNU AGPL-3.0 text as `/COPYING`; ensure the Electron build bundles it + the preserved upstream notices.
- **P2-23 · Docs describe OpenCode as "vendored under `research/opencode`" — it is neither vendored nor a submodule (git-ignored).** `JUNE_context.md:26` · `NIGHTJAR_LICENSE_AND_ATTRIBUTION.md:34` (points attribution at `research/opencode/LICENSE`, which doesn't exist on a clone). This wording actively **masks P0-1.** **Fix:** state OpenCode is *fetched at setup*; repoint the MIT attribution at `research/odysseus/licenses/opencode-MIT-LICENSE.txt` (present via submodule) as primary.
- **P2-24 · `browser-use` README documents the *pre*-NJ-14 silent-cloud-leak precedence as intended behavior.** `browser-use-mcp/README.md:13-27` vs `server.py:74-125`. The code correctly defaults **local** and only routes cloud on an explicit `NIGHTJAR_BROWSERUSE_PROVIDER`; the README says a stored key alone prefers cloud — a maintainer "aligning code to doc" would **reintroduce the exact privacy leak NJ-14 closed** (rule 7). **Fix:** rewrite the Model section to match the code.

### 4.4 — P3 (minor / cleanup / lower-likelihood)

Condensed — each is real and cited; fix in the cleanup sweep.

| ID | Finding | Location | Fix |
|---|---|---|---|
| P3-1 | Offline-first undercut: OpenCode grep/glob **fetch a ripgrep binary on first use** | `AUDIT_REPORT.md:141` | pre-bundle/pin rg in setup, or document as a first-run net dep |
| P3-2 | `email` E2E test hardcodes `venv/bin/python` (can't run on Windows) | `tests/test_email_send.py:14` | OS-aware interpreter / `sys.executable` |
| P3-3 | MCP-surface test harness hardcodes POSIX paths + `/tmp` | `phase2-mcp/tests/test_mcp_client.py:17,44,46` | `Scripts/python.exe` split + `tempfile.gettempdir()` |
| P3-4 | Probe/README run instructions use POSIX `bin/python` + `VAR=x cmd`; stale test counts; stale `/health` doc | `phase-cad/smoke_test.py:11`, `browser-use-mcp/README.md:44-51`, `telegram-scheduler/README.md:91` | add Windows invocations; correct counts |
| P3-5 | `faster-whisper` STT (transcribe tool + wake daemon) has no wall-clock timeout | `mcp_server.py:49`, `voice.py:69`, `wake_daemon.py:305` | thread+join `NIGHTJAR_STT_TIMEOUT_S` |
| P3-6 | `OLLAMA_HOST` drift: config uses `localhost`, vision uses `127.0.0.1` (IPv6-first on Windows can dead-hop) | `config.py:19` vs `vision.py:156` | standardize on `127.0.0.1` |
| P3-7 | `newSession()` doesn't guard `createSession` (unlike resume/delete) → create failure silently no-ops the slot | `SessionsContext.tsx:938-948` | try/catch + `setStatus` |
| P3-8 | `BYOKSettings.remove()` has no `catch` → failed key removal fails silently | `BYOKSettings.tsx:43-53` | mirror `save()` |
| P3-9 | `VisionBanner` action buttons drop their promise (unhandled rejection, no click feedback) [NJ-7] | `VisionBanner.tsx:54,71` | `.catch` + "installing…" state |
| P3-10 | preload `getConfig` type omits `isWSL` (renderer relies on it) | `preload/index.ts:34-35` | add `isWSL: boolean` |
| P3-11 | Persistent banners use `role="alert"` (assertive) → screen-reader re-announces on every mount | `CloudBanner.tsx:11`, `CapabilityCloudBanner.tsx:28` | `role="status"`/`aria-live=polite` |
| P3-12 | Create-Image is a permanent dead-end in Local mode (`localImagePresent` hardcoded `false`) [NJ-6] | `ChatScreen.tsx:56` | wire to real diffusion health when it lands (honest stub today) |
| P3-13 | `CodeScreen` folder-select + auto-accept-edits are disabled scaffolds | `CodeScreen.tsx:44-56` | none now; **rule-1**: if auto-accept ships it must be a `permission` mode, never `tools:{edit:true}` |
| P3-14 | `buildHeroModel()` `execFile` has no `maxBuffer` cap (sibling converter does) → chatty OCCT stderr can spuriously fail the hero demo | `cad.ts:71-96` | `maxBuffer: MAX_OUTPUT_BYTES` |
| P3-15 | Image gen has no backend on a fresh Windows box, failure is console.warn only [NJ-6] | `index.ts:145-181` | surface a reconcile status to the renderer |
| P3-16 | Monthly reminders on the 29/30/31 **fire on the 28th every month** (flat clamp to 28, not month-end) | `schedule_backend.py:67`, `nl_intent.py:106` | clamp to the month's real last day |
| P3-17 | `nl_intent.py` is dead in phase2-odysseus (only its test uses it) and is **hand-duplicated** into telegram-scheduler | `pim_server.py:21`, `telegram-scheduler/app/nl_intent.py` | share one installable module or add a CI sync check |
| P3-18 | `no-destructive-write` only gates `write`; a full-file rewrite via `apply_patch`/`patch` bypasses it (rule-4 hole) | `nightjar-no-destructive-write.ts:44-45` | also inspect patch payloads for delete+add/full-replace |
| P3-19 | Config drift across the 4 **non-runtime** `opencode.json` files: `venv/bin/python` (Windows-broken), **no safety plugins/agents**, `odysseus-email` re-enabled | `phase2-mcp/workspace/opencode.json:21`, `workspace-scoped/opencode.json:10-16` | delete or reconcile; document the one authoritative config |
| P3-20 | `nightjar-run.mjs` freeze-watchdog is **dead code** (not wired into the app) — the Phase-1.5 pre-model-freeze recovery is absent from the shipped supervisor | `nightjar-run.mjs` vs `services.ts:106-126` | integrate freeze detection into the supervisor, or mark retired + note in KNOWN_ISSUES |
| P3-21 | …and if ever run, `nightjar-run.mjs` uses POSIX process-group kill (win32-broken) + whitespace-splits a path (breaks on `C:\Users\John Doe\…`) + targets the missing engine tree | `nightjar-run.mjs:31-34,50-58,117` | argv array + `taskkill /T /F` branch; folds into P3-20 |
| P3-22 | Graceful shutdown (`taskkill` without `/F`) is a no-op for windowless console sidecars on Windows → every quit costs the full 2.5s then force-kills (no clean flush) | `supervisor.ts:18-26,451-459` | send `CTRL_BREAK` to the detached group first, or shorten the win32 grace + document |
| P3-23 | Standalone CAD tab diverges from LAB Mechanical: missing per-part visibility checkboxes; scene-lifecycle duplicated (`CadViewer` vs `useCadScene`) | `CadViewer.tsx:124`, `CadInspector.tsx:55` | backport checkboxes or accelerate M-CADfold |
| P3-24 | Wake word ships the **stock `hey_jarvis`** model — "Hey Nightjar" doesn't wake it (documented, untrained) | `wakeword.py:42,57` | train `hey_nightjar.onnx` (moot on Windows until P1-2) |
| P3-25 | Telegram global cost cap is **refunded even after the paid LLM parse already succeeded** (schedule-failure path) → weakens the "un-bypassable" ceiling | `telegram-scheduler/app/core.py:68-73,86-90` | refund only the per-user slot on schedule-failure |
| P3-26 | `PHASE2B_REPORT.md` prescribes the rule-1 footgun (`tools` allow/deny map) though the shipped config correctly uses `permission` | `PHASE2B_REPORT.md:88-91` | correct the report text |
| P3-27 | Orphaned root `package-lock.json` (empty stub, no root `package.json`) | `package-lock.json:1-7` | delete |
| P3-28 | Minor odysseus nits: `workspace-scoped` demo `venv/bin/python`; duplicate `ddgs`+`duckduckgo_search` pins; `datetime.utcnow()` deprecated on 3.12 | `requirements.txt:22,25`; `schedule_backend.py:41` et al. | tidy when convenient |
| P3-29 | Telegram live send/receive + live paid-LLM round-trip still **owed** (disclosed, needs real secrets) | `telegram-scheduler/README.md:106-114` | run once with a real `BOT_TOKEN`+key |

---

## 5. Confirmed correct / working (do not "fix")

So the cleanup doesn't churn things that are right (several are genuinely well-built):

- **CAD/Mechanical backend on native Windows — verified live.** build123d import + STEP export + the
  **NJ-18 STEP→GLB converter** (rebuild tree from `.wrapped` handles + validate GLB bytes for
  `nodes>0`/`meshes>0`) all pass. `cad_mcp_server.py` forces `BUILD123D_IN_PROCESS`; the 180s MCP
  cap + the 60s `execFile` SIGKILL cap are both present; app-side venv resolution is OS-correct.
- **`browser-use` egress guard [NJ-14].** Defaults local; cloud only on explicit
  `NIGHTJAR_BROWSERUSE_PROVIDER`; a stored key alone never routes cloud; rule-3 `asyncio` cap on
  `agent.run`; run serialization. Code + tests correct (README is wrong — P2-24).
- **Telegram caps/hardening.** Per-user + un-bypassable global daily cap, LRU rate limiter, per-call
  LLM timeout, constant-time token compare, refuse-to-boot on `BOT_TOKEN`-without-`API_TOKEN`,
  token scrubbing. (One P3 refund nuance — P3-25.)
- **Rule-1 permission maps in the live `workspace/opencode.json`.** Deny-by-default + explicit
  allow/ask; edit/write/bash/image/browser are `ask`; no `tools:{x:true}`. (Intent gap only at
  P2-13; drift in the *non-runtime* configs at P3-19.)
- **Rule-3 timeouts** on `deep_research` and `web_search` (hard `asyncio.wait_for` + token caps).
- **NJ-16 task lifecycle math** (create/due/mark_fired/migration) correct + tested; **NJ-17 desktop
  reminder poller is now implemented** and wired (was listed open in your context).
- **Renderer connection/session/permission core** — the fragile, safety-relevant part — is
  *substantially sound*: reconnect superseded-run guards, slot-GC abort-before-forget, permission
  queue reply/abort reconciliation, the NJ-25 CAD auto-export tracker, `healToOffline`,
  `deriveGlobalMode`. The residuals are the specific gaps above (P2-5, P2-8, P3-7).
- **Odysseus patch applies cleanly** to the pinned submodule; every ORM symbol the wrappers import
  exists in the pinned Odysseus.
- **Attachments on native Windows** — `attachments.ts` + `ChatSurface` paste/drop take the normal
  DOM/`webUtils.getPathForFile` path when `isWSL()===false`; the WSL-only workarounds are correctly
  isolated. *No static defect blocks native paste/drag* — but the real OS paths (NJ-27/28/29) remain
  **unverified natively** and need a live GUI+keystroke test once the engine is up (see §7 Decision 6).

---

## 6. Recommended cleanup implementation plan

**Sequencing.** One PR at a time, off fresh `main`, under the standing merge rules (BugBot →
fix-on-same-branch → merge → pull). Land **Phases 0–3 before resuming LAB PR-5b**; Phase 4 can
interleave. Each phase ends with the verification it demands (rules 6/8) — nothing marked done from
config-shape alone.

### Phase 0 — Reproducible engine + working Windows setup *(unblocks everything; do first)*
Fixes: **P0-1, P0-2, P1-5, P1-6, P2-23, P3-1.**
1. Make `research/opencode` reproducible at **`sst/opencode@7a8e7c88`** — pinned submodule *or*
   scripted pinned clone (§7 Decision 1). Whichever: it must also run `bun install` in the engine
   tree with **bun on PATH** (else the `tree-sitter-powershell` postinstall aborts and leaves the
   `extend-shallow` gap I hit live).
2. Add the `existsSync(OPENCODE_ENTRY)` **preflight** (via a `ServiceDef.preflight` hook) → a real
   *"engine source missing — run setup"* failure instead of a crash-loop.
3. Fix the **Windows setup path**: engine-fetch + venv steps in `WINDOWS_SETUP.md §9`; make
   `setup.sh` OS-aware or add `setup.ps1`; script the odysseus **patch-apply**; correct the README
   "one-shot" claim and the "vendored" wording (P2-23).
4. Pre-bundle/pin ripgrep for the offline promise (P3-1), or document it.
**Verify (live, this box):** clean `bun install` on a good network → `opencode-serve` binds `:4096`
and `GET /agent` returns the 5 Nightjar agents; then a real prompt answers (needs a BYOK key or
local llama). *(This is the exact step I could not finish here due to npm-registry network limits.)*

### Phase 1 — Native-Windows portability *(make it start & run natively)*
Fixes: **P1-1, P1-2, P1-3, P1-4, P2-10, P2-11, P3-2, P3-3, P3-6, P3-22.**
- Inject `HOME`/data-dir env in `opencodeServeEnv()` (P1-1); branch `LLAMA_BIN` on `IS_WIN` (P1-4);
  fix `git-gate` separators + `-uall` (P1-3); wake daemon win32 capture + visible fallback (P1-2);
  OS-aware `python3`→`py`/`python` in hw-detect/hwcheck + auto-recall (P2-10, P2-11); test-harness
  paths (P3-2, P3-3); `OLLAMA_HOST`→`127.0.0.1` (P3-6); win32 shutdown (P3-22).
**Verify:** on native Windows, drive a coding-agent multi-file `preview/` write and confirm it
**survives** (P1-3); confirm MCP data lands where the main process reads it (P1-1); confirm local
chat starts with a real `llama-server.exe` (P1-4).

### Phase 2 — Safety-gate correctness + missing timeouts *(make it effective & bounded)*
Fixes: **P2-1…P2-5, P2-12, P2-13, P3-5, P3-18, P3-19.**
- Add wall-clock caps to `runImageSeed`, local vision, `docs_query`, diffusion (`--gen-timeout` via
  **odysseus-patches**), `promptAsync`/`replyPermission`, STT (P2-1..5, P3-5).
- `doom-loop` consecutive-reset + read-only exclusion + eviction (P2-12); extend
  `no-destructive-write` to patch tools (P3-18); reconcile/delete the drifted `opencode.json` files
  (P3-19); PIM/memory `allow`→`ask` per §7 Decision 4 (P2-13).
**Verify (rule 6):** re-trigger each — e.g. force a slow seed and confirm the UI no longer hangs;
drive a real `edit` and confirm `permission.asked` still fires after the changes.

### Phase 3 — Observability + your explicit UX asks *(make it smooth & legible)*
Fixes: **P2-6, P2-7, P2-8, P2-9, P2-14, P2-15, P2-16, P2-17, P2-18, P2-20, P3-15.**
- **Surface sidecar logs** to the renderer + a health-strip viewer (P2-6) and click-to-restart
  (P2-7) — this alone turns most Windows first-run failures from opaque to diagnosable.
- **Dismissible banners** with re-arm-on-change + persistent switcher border (P2-14); "Switch to
  local" → full go-local or relabel (P2-15).
- Terminal "engine failed" state (P2-8); concurrent bring-up (P2-9); CAD WebGL guard+fallback
  (P2-16) and hidden-tab render pause (P2-17); voice overlay dismiss+timeout (P2-18); scheduler/image
  "unavailable — finish setup" status (P2-20, P3-15).

### Phase 4 — Completeness, cleanup, docs, licensing *(no false-greens; interleavable)*
Fixes: **P2-19 (this *is* PR-5b), P2-21, P2-22, P2-24, P3-4, P3-7…P3-14, P3-16, P3-17, P3-20/21, P3-23…P3-29.**
- The big one is **P2-19 = LAB PR-5b** (per-project isolation) — resume the build here once Phases
  0–3 are green and the shell can actually be driven on real GPU.
- Bug fixes (monthly clamp P3-16, `newSession` guard P3-7, `BYOKSettings.remove` P3-8, Telegram
  refund P3-25); dead-code removal (`nightjar-run.mjs` P3-20/21, root lockfile P3-27, `nl_intent`
  dup P3-17); doc/licensing (COPYING P2-22, browser README P2-24, PHASE2B report P3-26, run-instr
  P3-4); DST/tz (P2-21, §7 Decision 5); accessibility (P3-11).
- **Housekeeping:** add each still-open item to `KNOWN_ISSUES.md` as an `NJ-*` (the Windows setup
  gap, the git-gate misfire, the wake-daemon crash, the log-surfacing gap) so nothing regresses.

---

## 7. Decisions I need from you (before Phase 0/2/4)

1. **Engine sourcing:** pin `research/opencode` as a **git submodule** at `7a8e7c88` (cleanest,
   composes with `--recurse-submodules`, but adds a tracked gitlink to a large upstream), **or** keep
   it git-ignored and add a **scripted pinned clone + `bun install`** to setup? *(I lean submodule.)*
2. **NJ-32 (6 GB GPU vision), still open:** (a) cloud vision (Vision=Online + a vision model), (b)
   tune local VRAM so `gemma3:4b` co-fits, or (c) images-cloud-only? This gates how P2-2 degrades.
3. **Banners:** confirm the **dismiss-with-re-arm-on-change + persistent-switcher-border** approach
   (keeps the privacy intent), rather than a plain permanent dismiss?
4. **Assistant PIM/memory writes (P2-13):** flip `note/task/calendar/save_memory` to `ask`, flip only
   `calendar_create_event`, or **document** them as intentionally auto-approved for a smooth assistant?
5. **Desktop recurring-reminder DST drift (P2-21/NJ-19):** fix now (persist tz), or accept ±1h for
   the free tier and defer (as currently)?
6. **When the engine is up, do you want me to drive the live GUI paste/drag/clipboard test** on
   native Windows to finally close NJ-27/28/29 (needs a real keystroke — only you or a live session
   on the box can), or leave those as "verify at first real use"?

---

## 8. Disclosures (what this audit touched on disk)

No **tracked** file was edited. Two git-ignored side effects from the live root-cause check remain on
this box and are safe to keep (they're the recovery you'll want anyway):

- **`research/opencode/`** — freshly cloned `sst/opencode` @ `7a8e7c88` (git-ignored; not tracked).
  Its `node_modules` is **partially installed** — a subsequent `bun install --ignore-scripts` on a
  good network hit npm-registry `ConnectionRefused` and left it incomplete (`extend-shallow` still
  missing). **Re-run a clean `bun install` (bun on PATH) before relying on it.**
- Scratch artifacts under the session temp dir only (finding extracts, an engine-launch script). No
  changes to `phase3-ui/`, `phase2-*`, `phase-cad/`, `opencode.json`, or any doc.

---

*End of audit1.md. Findings: 2×P0, 6×P1, 24×P2, 30×P3 (deduped, 0 rejected). Coverage: all
Nightjar-authored `phase1-engine`, `phase2-mcp`, `phase2-odysseus`, `phase-cad`, `browser-use-mcp`,
`diffusion-mcp`, `telegram-scheduler`, `phase3-ui/src` files + all 5 `opencode.json` + plugins +
setup/docs. Vendored upstream excluded by scope.*
