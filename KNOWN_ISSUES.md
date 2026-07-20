# Nightjar — Known Issues (tracking)

Issues discovered mid-phase and deliberately deferred to a dedicated pass, so
they don't derail the phase that found them. Newest first. Resolved items are
kept for the historical record with their root cause + fix + verification.

---

## 📌 OPEN DECISIONS & PENDING VERIFICATIONS (as of 2026-07-15, after PRs #66–#76)

Consolidated so nothing drifts. Prune as items resolve. (Cross-session copy: the `open-decisions` memory.)

**Decisions the maintainer must make:**
- **Image reading on the 6 GB GPU (NJ-32).** Local vision (`gemma3:4b`) can't fit alongside the chat model → images fail. Pick one: (a) **cloud vision** (Vision=Online + a vision-capable model/key — `gpt-oss-120b` is text-only), (b) **tune local VRAM** (fewer llama `-ngl` / smaller `-c` so vision fits, slower chat), or (c) images-cloud-only.
- **Dev-workflow (NJ-30).** Recommendation flagged, NOT applied: native **Windows** for GUI/interaction testing, WSL for headless CI + Linux packaging.
- **Stray `phase2-odysseus/workspace/demo_car.step`** (untracked CAD test output) — add to `.gitignore`? (offered, awaiting yes/no).

**FYI / user action:** Fireworks chat "healed" to the local model after the WSLg crashes (chat pref = offline). The key WORKS — just re-select Fireworks in the model dropdown.

**Verifications that can ONLY be closed on native Windows / hardware / a real keystroke** (do NOT mark "verified" from a WSL proxy — rule 8): real drag-drop attach (NJ-27/29), in-app Ctrl+V image paste (NJ-28), the picker dialog actually opening at `/mnt/c/Users` (NJ-26), the CAD viewer drawing in software (NJ-31); plus older rule-6 items (NJ-6 GPU/diffusion, NJ-7 Ollama vision, NJ-9/10/12/14, telegram-scheduler live round-trip).

**Deferred code follow-ups (own PRs):** NJ-19 (scheduler DST/tz), NJ-22 (startup validation of BYOK defaultModel vs `/config/providers`), NJ-23 (per-provider model picker for retired-model "pick another"), NJ-11/B3 (diffusion server-side `--gen-timeout`).

**Design plans (future, not v1):** the **LAB hub + Mechanical/Physics + Chem/Bio labs** design lives in `Lab.md` (repo root) — **design-only, deferred until after the Telegram work** (user, 2026-07-15). Chem's 14-tool set is decided: all kept; the four that conflict with JUNE's constraints (Elementari = Svelte, Catalyst.jl = Julia, Reaktoro = conda/C++, AiZynthFinder = dual-use retrosynthesis) are **kept via wrappers in a later sub-phase**, with lighter pip substitutes for V1. **Physics** (§5.4–5.8) tool stack is verified — V1 is entirely pip/permissive/CPU (SciPy/SymPy/PyBullet/MuJoCo/Pymunk/SfePy/py-pde/rayoptics/hapsira/ikpy); WASM engines (Rapier/Jolt/Ammo) rejected under CSP; heavy solvers (CalculiX/DOLFINx/Meep/OpenMC) conda-wrapped later. Open: `Lab.md` §9.8 (Chem — CSP fork, Ketcher, backend egress, ambiguous names Atom Simulator/MOSAIC, ML/data licenses, `chem_hazard_screen`) plus the **§5.8 Physics `physics_hazard_screen` device-signal ruleset** (the weapons/nuclear *scope* is **settled**: "simulate the phenomenon, not engineer the device" — a 2026-07-15 request to put weapon/explosive/nuclear-**device** design/optimization in scope was **declined and stays declined**, a hard boundary, not negotiable). §8 invariant-6 amended: dual-use is **kept-but-gated** (ask + red-teamed screen + audit + private), not declined at build time.

---

## 🧪 MANUAL VERIFICATION CHECKLIST (NJ-4 … NJ-11)

The Phase 0–6 pass (PRs #29–#35) code-wired every open item. Per **CLAUDE.md rule 6**,
nothing below is marked RESOLVED yet — each fix was implemented in a **headless** env with
no live stack/hardware, so it must be re-triggered on a real running instance before it
graduates. Run each check on the live app; when it passes, move that NJ item to ✅ RESOLVED
with the observed result.

**A. No special hardware — just the running app:**
- [ ] **NJ-4** (SSE reconnect): with a chat streaming, kill `opencode-serve` (`pkill -f "serve --port 4096"`); confirm the renderer auto-reconnects (recreates session + resubscribes) and the *next* prompt works — no window reload. (Also the BYOK-restart path.)
- [ ] **NJ-9** (image retry keeps its kind): force a **cloud** image turn to fail (bad/expired key or rate limit) → click **Retry on local model** → confirm it regenerates an **image**, not a chat reply about the prompt.
- [ ] **NJ-10** (persistent Stop): drive a coding edit so the permission ask fires; interrupt so the abort is dropped → confirm the ask clears, the session stays busy, and the red **Stop** stays clickable (session remains interruptible).
- [ ] **NJ-8** (large-artifact mitigation): on the **local 4B**, ask for a large single-file page → confirm you get multi-file output or a clean error, never a silent/garbage artifact; confirm a stronger BYOK model renders a big artifact fine.

**B. Needs Ollama + `gemma3:4b`:**
- [ ] **NJ-7** (local vision): with Ollama + `gemma3:4b` running → attach an image + ask about it → analysis works. Stop Ollama → composer **warns** (doesn't silently fail). Text docs (`.md`/`.txt`) work on any model.

**C. Needs a real GPU + `Z-Image-Turbo` pulled:**
- [ ] **NJ-6 / NJ-14** (offline image): with the model + GPU venv present and **Image = Offline** → generate → served **locally/offline**. Stop the diffusion server → image gen has **no backend** (NOT an auto cloud fallback anymore — NJ-14 removed that); set **Image = Online + a provider** to use cloud explicitly.
- [ ] **NJ-11 / B3** (diffusion wall-clock cap): the follow-up — add the server-side `--gen-timeout` backstop to `diffusion_server.py` and verify a hung generation is aborted server-side. GPU-only; lands with the NJ-6 hardware check.

**D. Needs a leftover/dev engine (adopt path):**
- [ ] **NJ-5** (adopted-engine restart): start a stray `opencode serve --port 4096` **before** launching June (so June *adopts* it) → change a BYOK key → confirm June restarts the adopted engine and the new key takes effect. Watch for orphaned MCP children (documented tradeoff).

**Also needs a real key (independent of the above):** the **cloud** image path was only mock-verified — with a real key, **set Image = Online** and pick the provider (NJ-14 — no longer auto-wired from key presence), then chat → approve → image, once for a real **OpenAI** key and once for a real **OpenRouter `sk-or-…`** key.

---

## 🔧 FIX IMPLEMENTED — RUNTIME/HARDWARE VERIFY PENDING

_All items below were code-wired in the Phase 0–6 pass (PRs #29–#35), plus a post-merge
audit follow-up (**PR #37** — NJ-12 + three hardening fixes surfaced by an independent
13-agent audit of the merged code). They stay here (not in ✅ RESOLVED) until re-triggered
on a live stack per the checklist above + CLAUDE.md rule 6. The only genuinely un-fixed
remainder is **NJ-11 / B3** (the server-side diffusion wall-clock cap), a GPU-only follow-up._

## NJ-40 — every Projects localStorage write swallowed its exception, so a failed save presented a fully successful UI — FIXED (feat/projects-ux-save-rename) 2026-07-20

- **What:** all four write paths in the Projects feature (`saveStr`, `saveFiles` in
  `projectContent.ts`; `persistProjects` in `projects.ts`; and `copyProjectContent`) caught their
  exception and returned `void`. The comments anticipated "localStorage unavailable", but the same
  bare `catch` also absorbs **`QuotaExceededError`** — realistic here, since localStorage has a ~5MB
  per-origin cap and pasting a large reference into a project's Files is an ordinary way to reach it.
- **Consequence:** the state update ran regardless of whether the write landed, so the UI reported
  success over a total persistence failure — the file appeared in the list, the project card appeared
  in the grid, and nothing had been written.
- **Why it was a blocker, not a filing (maintainer, 2026-07-20):** this was originally going to be
  recorded as a deferred item alongside NJ-36/37/38. It was correctly reclassified as a **prerequisite**
  of the Save indicator shipped in the same PR: an indicator layered on a write that cannot report
  failure would render "Saved" for writes that silently failed — **worse than no indicator**, because
  it makes an untrustworthy thing look trustworthy. Shipping the indicator without this fix would have
  been a regression, so the two shipped together.
- **Fix:** `saveStr`/`saveFiles`/`persistProjects` now return a boolean. `useProjectContent` records a
  per-part `SaveResult` and `ProjectView` renders **"Saved"** or **"Not saved"** from the actual result;
  `useProjects` exposes `storageOk` and both Projects surfaces show a "Changes not being saved" warning.
  No write path was moved, debounced, or buffered — the per-keystroke synchronous write is deliberate
  (it is what makes an edit survive an immediate unmount), and the indicator only *reports* it.
- **Verified (headless, rule 6 as far as it goes):** `projectContent.test.ts` forces the real failure —
  a `localStorage` stub whose `setItem` throws `QuotaExceededError`, plus the storage-entirely-absent
  case — and asserts the helpers return `false`. The tests were **mutation-checked**: flipping the
  `catch` back to `return true` makes exactly the two failure-path tests fail with `expected true to be
  false`, so they genuinely catch the regression rather than passing vacuously. Typecheck clean, build
  OK, vitest 65/65.
- **Second-order bug caught in review (Bugbot, PR #125):** the first cut kept `storageOk` in
  `useProjects` **component state**. `ProjectsHome` and `ProjectView` each call that hook and only one
  is mounted at a time, so opening or leaving a project remounted it, re-initialized the flag to
  healthy, and **silently cleared the "Changes not being saved" warning while storage was still
  broken** — the same false-success this entry is about, one level up. Fixed by moving storage health
  to a module-scoped store (`lib/storageHealth.ts`) consumed via `useSyncExternalStore`, so every
  mounted consumer agrees and a remount inherits the current truth. Content writes
  (`useProjectContent`) feed the same signal, since a failed content write means the origin's storage
  is broken app-wide, not just for one chip. Worth recording: the *fix* for a false-success bug
  reintroduced a narrower false-success, which is exactly why this class needs a test rather than an
  inspection.
- **Third-order bug, also caught in review (Bugbot, second pass on PR #125):** `copyProjectContent`
  and `deleteProjectContent` still swallowed their exceptions. On **duplicate**, a content copy that
  failed on quota while the much smaller projects-list write succeeded produced a duplicate card with
  none of its Memory/Instructions/Files carried across — and `storageOk` stayed `true`, because
  reporting each write separately let the later small success clear the flag the larger failure had
  just set. Fixed three ways: both helpers now return a boolean; `copyProjectContent` **rolls back its
  partial writes** so a failed duplicate leaves no half-populated project behind; and every store
  operation now reports storage health **once**, combining every write it made (`mutate` returns its
  result instead of reporting). `duplicate` aborts rather than creating a contentless copy.
- **Fourth-order bug (Bugbot, third pass on PR #125):** the *reverse* failure ordering. The content
  copy can SUCCEED and the projects-list write then fail — leaving Memory/Instructions/Files in storage
  under an id that appears in no list. That is orphaned **permanently**, because only `remove()` ever
  deletes content and it cannot reach an id it cannot see. Fixed by extracting `persistDuplicate()`
  (storage-side sequencing, rollback on either ordering) and reverting the in-memory insert too, so a
  failed duplicate is simply a duplicate that did not happen. The extraction also made this testable
  without a React renderer, which is why it has a test at all.
- **The pattern worth remembering from this entry:** four successive rounds of the *same* defect class
  — a storage failure the UI reported as success — each found only because something actively looked
  for it. Three were caught by Bugbot; the others by **mutation-checking**, which twice caught
  **vacuous tests** that a careful reading did not:
  1. The rollback test used a quota boundary that made the copy throw on its *first* write, so nothing
     was ever partially written and the orphan assertion passed with **or without** the rollback it
     claimed to verify. Deleting the rollback left the suite green.
  2. The "content copy fails" test never seeded the source, so `copyProjectContent` found no parts,
     trivially succeeded, and the failure scenario never occurred. It asserted nothing.
  Both looked entirely reasonable on the page. The rule this earns: for any guard whose whole purpose
  is a failure path, **assert then mutate** — break the guard and watch the specific test go red — or
  the test is decoration, and a green suite is evidence of nothing.
- **Residual (rule 8):** the *rendered* failure chip was not confirmed in a real GUI — that needs a
  native-Windows run with storage actually filled (or `setItem` stubbed in DevTools). The boolean
  contract underneath it is proven headlessly; the pixels are not.

## NJ-39 — live-preview never rendered: the renderer CSP declared no `frame-src` (and no `img-src`, silently breaking every `data:` image) — FIXED (fix/preview-csp-frame-src) 2026-07-20

- **Severity:** **P1** — the whole live-preview/Artifacts panel was dead in **both** dev and packaged
  builds, and (via the same root cause) every `data:` URL image in the app was refused at render time.
- **Found by:** maintainer **GUI testing** of PR #120 on native Windows — "Download works, Open shows
  nothing" (a blank white pane). Exactly the class of defect CLAUDE.md rules 6/8 exist for: the code,
  the IPC seam, the mirror, and the loopback bind were **all** healthy and every headless check passed.
- **What (frame-src):** `phase3-ui/src/renderer/index.html` declared `default-src 'self'` with no
  `frame-src` and no `child-src`. Per CSP3 fallback (`frame-src` → `child-src` → `default-src`), the
  preview `<iframe>` was judged by `default-src 'self'` — but `main/preview-server.ts` serves at
  `http://127.0.0.1:<ephemeral>`, cross-origin to the renderer in dev (`http://localhost:5173`) **and**
  in production (`file://`, whose `'self'` cannot match any `http:` URL). Chromium refuses the
  navigation and **renders no error page**, so the frame stayed an empty document over
  `ArtifactPanel`'s `bg-white` wrapper → "a blank white panel". The trap: `connect-src` *already*
  whitelisted `http://127.0.0.1:*`, which reads reassuring but is inert — **`connect-src` governs
  fetch/XHR/WebSocket only and has no authority over frame navigation.** The loopback exemption had
  been granted to the one directive that does not cover framing.
- **What (img-src, same root cause, separately discovered — rule 7):** `img-src` was also absent, so it
  too fell back to `default-src 'self'` — and **`'self'` does not match the `data:` scheme**. Four live
  render paths push `data:` URLs into `<img>`: composer attachment thumbnails
  (`ChatSurface.tsx`), optimistic user-message images and rehydrated history images
  (`SessionsContext.tsx`), and **`generate_image` results** (`main/index.ts` returns a `data:` URL by
  construction). The image-gen case is the worst shape of this bug: the model generates, the file is
  written, main reads it back, and the renderer is refused at the **last** step — so the feature reads
  as broken on complete success.
- **Fix (this PR):** declare both directives explicitly —
  `frame-src 'self' http://127.0.0.1:*` and `img-src 'self' data: blob:`. Purely additive; no directive
  was loosened and `default-src 'self'` still governs everything else. `frame-src` must use a port
  wildcard because the preview server binds `listen(0, …)`, so the port differs every launch; this
  grants no trust beyond what `connect-src` already grants the same origin, and the frame keeps
  `sandbox="allow-scripts allow-forms"` (no `allow-same-origin`), so the preview document stays
  isolated from the app origin.
- **Also fixed:** the bare `.catch(() => {})` swallows in `ArtifactContext`/`ArtifactPanel` that made
  this invisible now `console.error` with context. A failure in this seam left **no trace at all**,
  which is why DevTools was the only available diagnostic.
- **Deliberately NOT added:** `worker-src`. Flagged during review, but no worker is instantiated
  anywhere in the renderer (the orb explicitly avoids them) and a same-origin worker would already be
  permitted by the `default-src` fallback — only a `blob:`-constructed one would be refused. Adding it
  would be noise, not hardening.
- **Scope — BOTH preview surfaces were dead, not just chat.** `CodeScreen` renders the identical
  `ArtifactPanel`/iframe fed by the coding agent's `write`/`edit` mirror, so the **Code tab's** Preview
  was blank too. It went unnoticed because that panel's Code and Files tabs use `previewRead`/
  `previewList` over IPC (no iframe, so they worked), and the streaming choreography parks the user on
  the Code tab during a write, only flipping to Preview 1200 ms after it settles.
- **Alternative considered, not taken:** register a custom `nightjar-preview://` standard/secure scheme
  so the preview is same-origin-ish and needs no CSP widening at all. Tighter than a loopback port
  wildcard — the wildcard does let the renderer frame *any* loopback port, not only ours — but a
  materially larger change to the serving path. Recorded here as the natural hardening follow-up if the
  loopback allowance ever becomes uncomfortable; the wildcard grants nothing `connect-src` didn't
  already grant that same origin.
- **Verification (rule 6 — OPEN, needs the maintainer's real GUI run):** static analysis is *not*
  sufficient for this class. To close: run the app on native Windows with DevTools open and confirm
  (a) the `Refused to frame 'http://127.0.0.1:…'` console error is **gone** and the artifact actually
  **paints** in the Preview pane — on **both** the Chat artifact card and a coding-agent `write` in the
  Code tab, two different entry points into the same iframe — and (b) an attached image thumbnail
  renders (the `img-src` half). Headless/typecheck passes prove nothing here: the previous, broken
  state passed every one of those same checks, and NJ-8's corrected entry above shows the existing
  e2e test structurally cannot catch it.

## NJ-38 — `preview-server` reflects any caller's `Origin` into `Access-Control-Allow-Origin` — OPEN 2026-07-20

- **What:** `phase3-ui/src/main/preview-server.ts` sets
  `resp.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*")` unconditionally, echoing
  whatever `Origin` the caller sent. Any origin able to reach the loopback port can therefore read the
  per-session preview sandbox (generated artifacts, mirrored agent `write`/`edit` content).
- **Bounds:** the server binds `127.0.0.1` only (not routable off-box) and the port is ephemeral, so
  exploitation needs local code execution or a browser on this machine being induced to request the
  right port. Not remotely reachable.
- **Discovered:** during the NJ-39 diagnosis; **pre-existing and independent** of that bug. Filed
  rather than drive-by fixed (rule 7) because tightening it means deciding what the legitimate origin
  set actually is — the framed document itself is cross-origin and sandboxed, so a naive lock to the
  renderer origin needs checking against the real frame load first.

## NJ-37 — orb TTS falls back to a `file://` URL that `media-src` refuses → silent silence — OPEN 2026-07-20

- **What:** `NightjarOrb.tsx`'s `loadTtsAudio()` prefers the IPC path (`nightjar.readAudio` → bytes →
  `blob:` URL, which is allowed). When that bridge is unavailable it falls back to
  `return path.startsWith("file:") ? path : \`file://${path}\`` — and the CSP's `media-src 'self' blob:`
  refuses the `file:` scheme. The result is **no audio and no error surfaced to the user**.
- **Why it matters (rule 8):** this is a textbook silent no-op — the degraded path was written *as* a
  fallback but cannot work under the app's own CSP, so TTS just goes quiet with no visible signal.
  A correct fallback either surfaces a visible "audio unavailable" state or is removed as dead code.
- **Not fixed here** (rule 7): out of scope for the CSP/preview fix, and choosing between "surface a
  fallback UI" and "delete the unreachable branch" needs a real run to see whether the IPC path is
  ever actually absent in practice.

## NJ-36 — stale `ArtifactContext` header docs + inconsistent `nonce` dep in `ArtifactPanel` — OPEN (docs/nit) 2026-07-20

- **What:** `ArtifactContext.tsx`'s header comment states the provider "Resets on sessionID change — a
  fresh connect or a reconnect gets a new session id". No such effect exists any more: after PR #122
  resets are driven **only** by screens calling `syncCodeSession`/`syncChatSession`, precisely so a
  reconnect does *not* wipe a pinned chat's open canvas. The comment now describes the behavior the
  #122 fix deliberately removed, which actively misleads anyone auditing this path.
- **Secondary:** `ArtifactPanel`'s preview-URL effect omits `nonce` from its dep array while the
  sibling file-list effect includes it. Harmless today because `iframeSrc` appends the nonce as a query
  param anyway — but it is a real inconsistency for whoever next touches the cache-busting.
- **Filed not fixed** (rule 7): found during the NJ-39 diagnosis, unrelated to the CSP defect.

## NJ-35 — assistant PIM/memory WRITE tools are auto-approved ("allow", no per-call prompt) — INTENTIONAL, DOCUMENTED (maintainer decision) 2026-07-19

- **Context (audit1.md P2-13):** the `assistant` agent's permission map
  (`phase2-odysseus/workspace/opencode.json`) grants `odysseus-pim_note_create` /
  `odysseus-pim_task_create` / `odysseus-pim_calendar_create_event` / `nightjar_save_memory` as
  `"allow"` — they WRITE user data with no approval prompt. Mechanically rule-1-compliant (uses the
  `permission` map, not `tools:{x:true}`), but against rule-1's *intent* that mutating tools prompt.
- **Decision (maintainer, 2026-07-19):** keep them auto-approved. Personal-data capture (a note, a
  task, a reminder, a memory) should be frictionless in the assistant; a per-call approval for every
  note would make it unusable. A deliberate, recorded exception — not drift.
- **Bounds that stay:** the consequential OS/egress actions remain `"ask"` —
  `nightjar_analyze_image`, `odysseus-image_generate_image`, `browser-use_run_browser_task`;
  edit/write/bash in the coding agent stay `"ask"`; `"*":"deny"` still hard-denies everything
  unlisted. So the auto-approve is scoped to LOCAL personal-data writes only.
- **Recorded in:** a comment above the allows in `workspace/opencode.json` + this entry (the
  decision was to document it in both the config and here). Verified the config still parses with the
  comment (engine `/agent` → 200).

## NJ-34 — native Windows: opencode-serve can't parse opencode.json because NIGHTJAR_ROOT (a backslash path) is substituted into JSON strings → /agent 400 → chat dead — FIXED (fix/windows-config-path) 2026-07-19

- **Severity:** **P0 on native Windows** — this, not just the missing engine, is why chat stays on
  "Connecting to the engine…" even after setup is complete. Found by **live-driving** the engine on
  Windows (CLAUDE.md rules 6/8); the static `audit1.md` pass could not catch it.
- **What:** `services.ts` (and `opencodeServeEnv()` in `index.ts`) pass `NIGHTJAR_ROOT` to
  opencode-serve as a native-Windows path with **backslashes** (`C:\dev\nightjar`, from `resolve()`).
  OpenCode substitutes `{env:NIGHTJAR_ROOT}` (and other `{env:…}` vars) into
  `phase2-odysseus/workspace/opencode.json` **string values** (e.g. the MCP `command` arrays), then
  parses the result as JSONC. The backslashes become **invalid JSON escape sequences** (`\d`, `\n`,
  `\v`, …) → `ConfigJsonError: InvalidEscapeCharacter` → the whole config fails to parse → `GET
  /agent` returns **400** → the supervisor's readiness probe (`httpOk(:4096/agent)`) never passes →
  `opencode-serve` is marked unhealthy → the renderer never connects. On WSL/Linux `NIGHTJAR_ROOT`
  is `/home/…` (forward slashes), so it never triggered — exactly why chat worked on WSL and dies
  on native Windows.
- **Verified (live, this box):** `NIGHTJAR_ROOT=C:\dev\nightjar` → `/agent` **400**
  (`ConfigJsonError`/`InvalidEscapeCharacter` at the cad MCP `command` path); `NIGHTJAR_ROOT=C:/dev/nightjar`
  (forward slashes) → `/agent` **200 in ~11 ms** with all four Nightjar agents
  (assistant/coding/research/cad). Same engine (`sst/opencode@7a8e7c8`), everything else identical.
- **Fix (this PR — fix/windows-config-path):** `services.ts` now exports slash-normalized
  `REPO_POSIX`/`HOME_POSIX` (`p.replace(/\\/g, "/")`) and the opencode-serve service-def env uses
  `NIGHTJAR_ROOT: REPO_POSIX` + injects `HOME: HOME_POSIX`; `opencodeServeEnv()` (the authoritative
  overlay in `index.ts`, applied via `setEnv` at startup + rebuilt on every restart) does the same.
  Windows accepts forward slashes in all these paths, so filesystem behavior is unchanged; no-op on
  POSIX (no backslashes). Injecting a normalized `HOME` also closes `audit1.md` **P1-1** (the MCP
  data-dir divergence when the ambient `HOME` is unset/backslashed).
- **Verified (rule 6, live re-trigger on this box):** backslash `NIGHTJAR_ROOT` → `/agent` **400**
  (`ConfigJsonError`); the fix env (`NIGHTJAR_ROOT=C:/dev/nightjar` + injected `HOME=C:/Users/axehe`)
  → `/agent` **200** with all four Nightjar agents (assistant/coding/research/cad). Plus a headless
  unit test (`services.opencode-env.test.ts`) asserting the opencode-serve env carries no
  backslashes in `NIGHTJAR_ROOT`/`HOME`; typecheck clean; vitest 37/37.

## NJ-33 — the OpenCode engine was obtained by no committed script (dead engine on any fresh clone) + setup was POSIX-only (broke native-Windows provisioning) — FIXED (PRs #93/#94 + build/windows-setup) 2026-07-19

- **Severity:** high — **P0 for a fresh clone.** `research/opencode` (the engine, "the only agent
  loop", run by bun from TS source per `phase3-ui/src/main/services.ts`) was **git-ignored, NOT a
  submodule, and cloned by no committed script** (`scripts/setup.sh` inited only the odysseus
  submodule). A fresh clone therefore had **no engine** → `opencode-serve` crash-looped (`⚡5`) and
  chat never connected. Surfaced on the WSL→native-Windows migration; the headline finding of
  `audit1.md` (P0-1/P0-2/P1-5/P1-6).
- **Compounding (Windows):** `scripts/setup.sh` (+ `phase-cad/setup.sh`) hardcoded POSIX
  `venv/bin/python` and `python3`, so under Git Bash on Windows `make_venv` failed and `set -e`
  aborted, leaving empty venvs; there was **no PowerShell setup path**, and `WINDOWS_SETUP.md §9`
  never fetched the engine — following it literally could not produce a working app.
- **Fix:**
  - **PR #93** — `research/opencode` is now a pinned **git submodule** → `sst/opencode@7a8e7c8`,
    sourced from the durable **`AxeH666/opencode`** fork (tag `nightjar-pin-7a8e7c88`) so the exact
    commit stays fetchable even if upstream's `dev` branch GCs it. A fresh clone gets it via
    `git clone --recurse-submodules` / `git submodule update --init`.
  - **PR #94** — the supervisor gained a `preflight` hook (single `spawn()` choke point); a missing
    engine now yields an actionable *"engine source not found — run setup"* `failed` state instead of
    an opaque crash-loop.
  - **build/windows-setup** — `scripts/setup.sh` is now **OS-aware** (Scripts/python.exe vs
    bin/python; `py -3.12` vs `python3`) and inits the engine submodule + `bun install`s it +
    provisions phase-cad; a new **`scripts/setup.ps1`** is the native-Windows one-shot (submodules
    incl. engine, engine `bun install` with an `--ignore-scripts` retry for the TUI-only
    tree-sitter postinstall, the Odysseus patch-apply, all venvs, the UI). `WINDOWS_SETUP.md §9/§3.3`
    now point at it and require `--recurse-submodules`.
- **Verified:** submodule fetch + gitlink pin at `7a8e7c88` (PR #93); the preflight unit test +
  live `services.ts` present/absent check (PR #94); on **native Windows**, a clean `bun install` of
  the recovered engine completes (1253 pkgs) and `opencode-serve` **boots, binds :4096, and serves
  all four Nightjar agents** (assistant/coding/research/cad) at `/agent` — **once `NIGHTJAR_ROOT` is
  passed with forward slashes** (backslashes break config parsing → **NJ-34**, fixed in its own PR).
  **Remaining (user-run, network-bound):** full provisioning of the heavy backend venvs
  (`phase2-mcp`/`odysseus`/`browser-use`/diffusion) — the script logic is OS-correct; a real
  end-to-end run needs the user's normal network + the optional GPU deps.

## NJ-32 — local image reading fails on a 6 GB GPU: the chat model fills VRAM, so local vision (gemma3:4b) runs on CPU and times out — FLAGGED (hardware limit; decision pending) 2026-07-15

- **Severity:** medium — attaching an **image** and asking about it fails (times out); TEXT/document attachments read fine. Diagnosed while chasing "not able to read files".
- **What (measured on this machine, RTX 4050 6 GB):** `llama-server` (Qwen3-4B chat) holds ~5.5 GB VRAM, leaving ~450 MB free. Ollama loads the vision model `gemma3:4b` (~3.3 GB) with `size_vram=0` → it runs on **CPU** → a tiny image takes 125s+ and hits the vision tool's 60s cap (`NIGHTJAR_VISION_TIMEOUT_S`, `phase2-mcp/nightjar_capabilities/vision.py`) → returns an error → the image "can't be read". A busy/slow image turn can also make a following plain message look unanswered. `gpt-oss-120b` (the user's Fireworks model) is **text-only**, so it isn't an image fallback.
- **Not a code bug — a hardware/VRAM ceiling:** a 4B chat model + a 4B vision model don't co-fit in 6 GB. Options (maintainer's call, see the OPEN DECISIONS section + the `open-decisions` memory): (a) **cloud vision** — Vision=Online + a vision-capable provider/model; (b) **tune local VRAM** — reduce llama `-ngl`/`-c` (`phase3-ui/src/main/services.ts`) so `gemma3:4b` fits, at some chat-speed cost; (c) images-cloud-only.
- **Verified:** direct Ollama `gemma3:4b` vision call on a test PNG → HTTP 000 / 125s timeout with `size_vram=0`; `nvidia-smi` shows ~450 MB free. Local text-doc reading verified working (model pulled a codeword out of an attached memo).

## NJ-31 — WSLg GPU-process crash could take the app/window down ("not responding"); force software rendering under WSL — FIXED + VERIFIED 2026-07-15

- **Severity:** high — under WSLg the GPU process fails to initialise ("Exiting GPU process due to errors during initialization"), spams GL ReadPixels stalls, and Chromium's software-WebGL fallback is disabled-by-default. That can crash the renderer/window, and a dead window reads as "the app stopped responding" (a user symptom: chat not answering "hello" even though the local model was fine). Part of NJ-30's WSLg-GPU story.
- **Fix (`main/index.ts`):** under WSL (`isWSL()`), at module load (before app `ready`) call `app.disableHardwareAcceleration()` + `app.commandLine.appendSwitch("enable-unsafe-swiftshader")`. This skips the failing GPU process and enables SwiftShader so rendering is stable in software AND the CAD three.js viewer still draws. Native Windows/macOS/Linux keep their real GPU (untouched).
- **Verified (WSL):** a fresh boot with the flags shows **"Exiting GPU process" = 0** (was 1), "software WebGL deprecated" = 0, GL ReadPixels stalls = 0; the app connects and chat responds ("hello" → reply); zero crashes. Software rendering is slower but stable. The CAD viewer rendering in software needs a GUI glance to confirm visually.

## NJ-30 — WSLg is NOT a supported interactive GUI environment; move GUI/interaction testing to native Windows — FLAGGED for maintainer (dev-workflow decision, NOT applied) 2026-07-15

- **Context:** the file-handling investigation (NJ-26…NJ-29) established that several interactive features are broken specifically by WSLg/WSL, not by JUNE's code:
  - **Drag-drop** — Windows→WSL DnD is not bridged by the platform (NJ-29); no payload is delivered.
  - **Clipboard image paste** — WSL hands Chromium an undecodable BI_BITFIELDS BMP (NJ-28; worked around via PowerShell).
  - **GPU / WebGL** — WSLg falls back to software SwiftShader; the app logs "Exiting GPU process", "software WebGL has been deprecated", and GL stalls.
  - **Desktop notifications** — "[scheduler] desktop notifications unavailable — local reminders disabled" under WSLg.
  All of these work on a native **Windows** build.
- **Recommendation (NOT applied — maintainer's call):** treat native Windows as the supported target for GUI/interaction testing, and reserve WSL for **headless CI + Linux packaging**. This is a dev-workflow change, so it's flagged here for a decision rather than changed unilaterally — no CI/build/workflow config was touched.

## NJ-29 — Windows→WSL drag-drop delivers NO payload (hard platform limitation); added a browse-instead fallback — HANDLED (fallback verified; real DnD is native-Windows-only) 2026-07-15

- **Severity:** medium (a headline complaint) but NOT fixable under WSL — Microsoft doesn't bridge drag-drop across the Windows→WSL boundary, so a drop into the WSL-hosted window delivers no files/uri-list at all. Confirmed by elimination: a synthetic real-File drop attaches perfectly (the code is correct), so the OS simply delivers nothing on a real drag.
- **Fix (graceful handling — `main/index.ts` config + `lib/platform.ts` + `ChatSurface.tsx`):** expose `isWSL` to the renderer; when a drop under WSL yields an empty result, replace the silent failure with a visible notice — "Drag-and-drop isn't supported under WSL. Click Browse (or paste) to attach instead." — plus a **Browse** button that opens the file picker. The drag overlay text also flips under WSL. Native Windows DnD is unaffected and works (via the webUtils path, NJ-27).
- **Verified (WSL):** with `config.isWSL=true`, a synthetic empty drop surfaces the notice + Browse button; typecheck (node+web) clean. Real Windows→WSL DnD is intentionally NOT attempted (there's no payload to read); native-Windows DnD needs a native build to confirm.

## NJ-28 — clipboard image PASTE silently failed under WSL (undecodable BMP); added a PowerShell read-through — FIXED (in-app Ctrl+V needs confirming) 2026-07-15

- **Severity:** medium — copying an image in Windows and pasting into JUNE under WSL did nothing (text pastes fine). WSL delivers the copied bitmap to the DOM clipboard as a BI_BITFIELDS BMP Chromium can't decode.
- **Fix (`main/index.ts` + `preload/index.ts` + `lib/attachments.ts` + `ChatSurface.tsx`):** new `nightjar:readWindowsClipboardImage` IPC — under WSL ONLY — shells out to `powershell.exe` (`[System.Windows.Forms.Clipboard]::GetImage()` → PNG → base64) and returns a data URL. On paste, when the DOM clipboard has no file AND no text (the WSL image case), the composer calls it and inserts the PNG as an attachment. Native Windows/macOS/Linux use the normal DOM path unchanged. Graceful null when powershell.exe is unreachable / no image; 8s wall-clock timeout (rule 3); runaway-output guard.
- **Verified (WSL):** powershell.exe reachable; round-trip (set an image on the Windows clipboard → the handler's exact command reads it back as valid PNG base64); the handler's full JS (spawn→parse→data URL) returns a valid `data:image/png;base64,iVBOR…`; typecheck (node+web) clean.
- **Needs a real Ctrl+V to confirm:** the full in-app flow (copy an image in Windows → Ctrl+V in the composer → chip appears). Every component is verified; only the live keystroke path is unexercised.

## NJ-27 — dropped/browsed files saved a base64 COPY instead of using the real path (File.path removed in Electron 32) — FIXED (real-path branch needs native Windows) 2026-07-15

- **Severity:** low-medium — it worked but wastefully (a saved copy per dropped image), and on native Windows the "proper" path was unavailable because `File.path` was removed in Electron 32.
- **Fix (`preload/index.ts` + `lib/attachments.ts`):** expose `webUtils.getPathForFile(file)` over the contextBridge — the ONLY Electron 32+ way to recover a dropped/browsed File's on-disk path (it must be called in the preload with the real File). `fileToAttachment` now: a File with a real path → read the ORIGINAL via `readAttachment` (real path for the local vision tool, no saved copy); a blob with no path (pasted screenshot) → `getPathForFile` returns "" → falls back to the FileReader + `saveAttachment` copy. `dragover` `preventDefault` is already in place (main.tsx window guard + the composer's `onDragOver`).
- **Verified (WSL):** `getPathForFile` is exposed and returns "" for a blob without throwing → the fallback (which the synthetic-drop harness confirms produces a chip) runs. Typecheck (node+web) clean.
- **Needs native Windows to confirm:** the real-path branch (a real OS-dropped file → non-empty path → `readAttachment`). WSL doesn't deliver OS file drops at all (the WSL DnD limitation), so that branch can't be exercised here; on native Windows DnD it makes the dropped file attach with its real path.

## NJ-26 — attach file picker opened at the empty Linux $HOME under WSL, hiding the user's Windows files — FIXED (dialog-open needs a GUI to confirm) 2026-07-15

- **Severity:** medium — under WSL the picker opened at the Linux home, where none of the user's real documents/images live, so "Browse" looked like it had nothing to attach.
- **Fix (`phase3-ui/src/main/index.ts` + `services.ts`):** `showOpenDialog` now sets `defaultPath` to the last-used folder (persisted in `ui-settings.json`, reused only if it still exists), else — under WSL (`isWSL()` via `/proc/version`, os.release() fallback) — the Windows user profile `/mnt/c/Users`. Native Windows/macOS/Linux fall through to the OS default. Image filters were already present.
- **Verified (WSL, logic):** `isWSL()` → true; defaultPath → `/mnt/c/Users` with no persisted dir, the persisted dir when it exists, falls back when stale. **Needs a GUI to confirm** the GTK/portal dialog actually OPENS at that path — if it ignores `defaultPath`, that's an xdg-desktop-portal version issue (force GTK via `--xdg-portal-required-version`, or ensure a portal backend ≥ v4); the value we pass is correct regardless.

## NJ-25 — CAD build→viewer handoff: model built the geometry but never called export, so the 3D viewer stayed empty — FIXED + VERIFIED 2026-07-15

- **Severity:** medium — the CAD pipeline (Fireworks/gpt-oss-120b → build123d → geometry) worked, but the built model never appeared in the 3D viewer. Confirmed on a real concept-car prompt: the model called `execute` (built + named parts) and `render_view` (PNG → /tmp) but NOT `export`, and even said "the image cannot be displayed in the chat interface" — it didn't know the viewer exists.
- **Root cause:** the viewer's watcher only fires on a completed `cad-build123d_export` (STEP→GLB); `render_view` produces a PNG that never feeds it. The agent was left to choose export and didn't.
- **Fix (one PR, 2 files):**
  1. **Auto-export** (`phase3-ui/src/renderer/src/context/SessionsContext.tsx`): a `cadExport` tracker (mirrors the NJ-7 image-retry) armed on every cad-agent send. If the turn built/rendered a shape but idled without an export, it auto-sends ONE export directive so the viewer fills without relying on the model — bounded by `retried` (no loop), surfaces a hint if it still fails. Also widened the export-path regex to catch the multi-file `Exported to:\n…` form.
  2. **Prompt steering** (`phase2-odysseus/workspace/opencode.json`, cad agent): made the LIVE 3D VIEWER explicit — `render_view` is YOUR-eyes-only (the user can't see it), the viewer updates ONLY on `export`, so every finished/changed model MUST end with `cad-build123d_export`; never say an image "cannot be displayed".
- **Verified (rule 6):** headless renderer harness — drove a real "make a 20mm cube" send on the CAD tab, stand-in simulated build (execute+render_view) with NO export → the renderer AUTO-FIRED the export directive (and stopped after the export, no loop). Regex unit-tested against real export outputs. Typecheck + 33 tests pass. NB: end-to-end with the real Fireworks model (prompt steering effect) needs the user's key — the auto-export safety net covers a model that still forgets.

## NJ-24 — main-process crash: `Supervisor.onChange` sent IPC to a DESTROYED window on shutdown ("Object has been destroyed") — FIXED + VERIFIED 2026-07-15

- **Severity:** medium — a scary "A JavaScript error occurred in the main process" dialog on quit / window close; the uncaught exception can leave the sidecar stack half-torn-down.
- **Context:** during app quit / window close a LATE event — a supervised child process exiting (→ `Supervisor.onChange`), or a vision-status push — fires `win?.webContents.send(...)`. `win?.` guards only NULL; a **destroyed** BrowserWindow is still a non-null object, so `win.webContents.send()` throws `TypeError: Object has been destroyed` as an UNCAUGHT main-process exception. Stack: `ChildProcess._handle.onexit` → child `'exit'` handler → `Supervisor.set` → `emit` → `onChange` → send. Pre-existing (not introduced by the recent connection/BYOK/Fireworks PRs); surfaced when the stack was killed out from under a live window.
- **Fix (`phase3-ui/src/main/index.ts`):** a `sendToRenderer()` helper guarded by `win && !win.isDestroyed() && !win.webContents.isDestroyed()` (isDestroyed() is the only reliable guard — `win?.` is not), routed BOTH send sites (`nightjar:status`, `nightjar:visionStatus`) through it, and null `win` on the window's `closed` event.
- **Verified (rule 6):** headless Electron repro — destroy the window, then the OLD `win.webContents.send()` throws "Object has been destroyed" (the exact dialog error); the guarded `sendToRenderer` is a safe no-op on a destroyed AND a null window.

## NJ-23 — Fireworks AI BYOK provider added; serverless catalog rotation caveat + no per-model "pick another" picker — FLAGGED (graceful, follow-up DEFERRED) 2026-07-15

- **Severity:** low — Fireworks chat/research works with a live model id; the caveat only bites when Fireworks retires the pinned model.
- **Context:** added Fireworks AI (registry id `fireworks-ai`, base URL from models.dev, OpenAI-compatible) as a BYOK provider for **chat + research** across the standard 4 touch-points: `phase3-ui/src/main/byok.ts` (switcher, default `accounts/fireworks/models/gpt-oss-120b`), `phase2-odysseus/workspace/opencode.json` (apiKey env ref), `phase3-ui/src/main/capabilities.ts` (research `onlineProviders`), `phase2-odysseus/servers/research_backend.py` (provider→base_url map). Image/vision intentionally skipped. websearch rides on the chat model (no extra wiring). Verified: the provider + `gpt-oss-120b` load in the live engine (`/config/providers`, 16 models); model-id split preserves the account-scoped path; typecheck + tests pass. **Unverified (rule 6):** a real end-to-end prompt/research run needs the user's Fireworks key.
- **Caveat (b):** Fireworks' serverless catalog **rotates** — a retired model **404s at prompt time**. That is already handled GRACEFULLY (not a hard crash): a 404 arrives as a `session.error` → `handleSessionError` surfaces the existing "cloud model failed → Retry on local model" offer, and the user can re-pick a provider in the switcher.
- **Deferred (durable):** the switcher exposes exactly ONE model per provider, so there's no in-app "this model was retired — pick another" flow. A proper fix is a per-provider model dropdown (list `/config/providers` models) + treating a 404 as "model retired" with that picker. Until then, a retired default is re-pinned in code (`byok.ts` + `research_backend.py`), verified against `curl :4096/config/providers`. Ties into NJ-22's durable defaultModel-validation idea.

## NJ-22 — BYOK default model ids drift out of the bundled models.dev registry (google/xai were dead-on-arrival) — FIXED, durable validation DEFERRED 2026-07-15

- **Severity:** high for the affected providers (100% chat failure), zero for the local-first default path.
- **Context:** found by the June breakage-audit. `BYOK_PROVIDERS[].defaultModel` (`phase3-ui/src/main/byok.ts`) is load-bearing — the switcher and the Local→Cloud toggle set the active chat model to `<provider>/<defaultModel>` and `promptAsync` sends it verbatim; the engine's `getModel` throws `ModelNotFoundError` (no fuzzy match) so every prompt fails before generation.
- **What:** on the 2026-07 registry bump, google `gemini-2.0-flash` and xai `grok-3` were dropped from the bundled catalog. Verified live: `curl :4096/config/providers` shows google starts at `gemini-2.5-flash`, xai at `grok-4.3`; the other six defaults resolve.
- **Fix (this pass):** google → `gemini-2.5-flash`, xai → `grok-4.3` (both verified present in the live registry). End-to-end with a real Google/xAI key is UNVERIFIED (no key on hand) — the id now resolves in the registry, which was the failure point.
- **Deferred (durable):** these constants silently rot on every catalog bump. Add a startup/test check that validates each `defaultModel` against `/config/providers` so a future mismatch surfaces loudly instead of killing that provider's chat.

## NJ-21 — drag-and-drop file attach: added a text/uri-list fallback for Linux/WSLg; NOT verified on real WSLg hardware — FLAGGED (needs a hands-on test) 2026-07-15

- **Severity:** medium (a headline user complaint), but environment-bound.
- **Context:** the composer's drop handler only read `DataTransfer.files`/`.items` (File objects). Standard browsers deliver those, but WSLg / some Linux desktops deliver a file drop as a `text/uri-list` of `file://` URIs with NO File objects — so the drop silently attached nothing (no chip, no error).
- **Fix (this pass):** `attachmentsFromDataTransfer` (`phase3-ui/src/renderer/src/lib/attachments.ts`) now, when no File objects arrive, parses `text/uri-list`/`text/plain` file:// URIs and reads them via the main process like Browse. Parser unit-tested; the standard File-object path is unchanged (fallback only fires when `files.length === 0`).
- **Verification GAP (rule 6):** cannot drive a real OS drag headlessly, so whether WSLg even delivers a uri-list (vs nothing at all) is UNCONFIRMED. If WSLg delivers no drop payload at all, no code fix helps — the reliable attach paths remain **Browse (📎)** and **paste**. Needs the user to drag a file onto the composer and report whether a chip appears.

## NJ-20 — renderer connection could WEDGE permanently on a half-open socket (no wall-clock timeout on the connect fetches or SSE stream) — FIXED + VERIFIED 2026-07-15

- **Severity:** high — this is the root cause of the reported "can't text CAD / won't reply to 'hey'": the app sat disconnected ("waiting for engine… (Failed to fetch)") for 20+ min while opencode was up and reachable (a headless harness connected to the same engine instantly).
- **Context / rule 3:** `OpenCodeClient.listAgents`/`createSession`/`subscribe` (`phase3-ui/src/renderer/src/lib/opencode.ts`) had NO wall-clock timeout. Over WSL2/NAT virtual networking a socket can go **half-open** (accepted, then silent — no bytes, no FIN/RST); the awaiting `fetch`/`reader.read()` then hangs FOREVER, so the connect retry loop never fires and the SSE "stream closed → reconnect" never triggers. This is exactly CLAUDE.md rule 3 (every long-running round-trip needs its own wall-clock bound) unmet in the client.
- **Fix (this pass):**
  1. `listAgents`/`createSession` → `AbortSignal.timeout(15s)` so a half-open connect rejects and the loop retries.
  2. `subscribe` → an idle watchdog (30s = 3× opencode's ~10s `/event` heartbeat) that aborts a silent stream so the caller reconnects.
  3. Renderer UX: a `connected` flag + a manual **↻ Reconnect** button (was only wired to a BYOK key change), a calm "starting the local engine…" message (replacing the scary raw "Failed to fetch"), and the composer now **blocks send while disconnected** (was silently discarding the typed message).
- **Verification (rule 6):** reproduced both failure modes in a headless Electron harness against a stand-in engine — half-open **connect** recovered at ~18s (15s timeout + retry), half-open **stream** recovered at ~33s (30s watchdog + reconnect); confirmed no reconnect churn against the real 10s-heartbeat opencode; friendlier message + Reconnect button verified appearing while disconnected and clearing on connect; full cold boot connects in ~15s and the assistant replies to "hey".

## NJ-19 — desktop local scheduler: NL recurring reminders fire at a frozen UTC clock (DST drift) and can use the UTC weekday, not the user's local one — FLAGGED (deferred; fixed in the always-on server) 2026-07-15

- **Severity:** low — affects only *recurring* reminders (`daily`/`weekly`/`monthly`) created from natural language, and only across a DST boundary or when the local→UTC conversion crosses midnight. One-off reminders and same-offset users are unaffected.
- **Context:** found while fixing the equivalent Bugbot findings on the **always-on Telegram server** (Task-6 PR 17, #65). The NL parser (`phase2-odysseus/servers/nl_intent.py`) converts the user's local wall-clock to UTC and stores `scheduled_time` (UTC `HH:MM`) + `scheduled_day` (the **UTC** weekday for weekly). The **desktop** scheduler (`compute_next_run` in `schedule_backend.py`, polled by `phase3-ui/src/main/scheduler.ts`) then computes `next_run` at that fixed UTC clock time forever.
- **What:** (1) **DST drift** — "every day at 8am" local is stored as a fixed UTC hour; after a daylight-saving change the local fire time shifts by an hour. (2) **UTC weekday** — for a late-evening local time that maps to the next UTC date, the weekly reminder's `scheduled_day` is the UTC weekday, so it can fire a day off from the local weekday the user meant.
- **Why deferred (not a drive-by fix):** the always-on server (#65) fixed this by scheduling recurring APScheduler crons **in the user's IANA timezone** (so the fire time re-derives each occurrence, DST-correct, on the local weekday). The desktop path stores everything as naive UTC and re-derives `next_run` in UTC; fixing it properly means persisting the user's tz + local wall-clock on the task row and computing `next_run` in local tz — a schema + `compute_next_run` change that belongs in its own PR, not folded silently into the CAD/telegram work (CLAUDE.md rule 7).
- **To do:** carry the user's tz (or local wall-clock) on `ScheduledTask` and compute recurring `next_run` in that tz, mirroring the always-on server's local-cron approach. Until then, recurring desktop reminders are correct at creation and drift at most one hour across DST.

---

## NJ-18 — upstream (build123d): `export_gltf` reports SUCCESS while writing an EMPTY GLB, and an `import_step` tree cannot be exported at all — FLAGGED + MITIGATION IDENTIFIED (blocks the Task-5 CAD viewer) 2026-07-14

- **Severity:** high **for the CAD feature** (it silently produces an empty 3D model), zero today (no CAD code shipped yet). Found by probing the real library **before** writing the converter, per CLAUDE.md rule 6 — not by reading its docs.
- **Context:** Task 5's exploded-view viewer needs a **GLB with one named node per part**. `build123d-mcp`'s sandboxed `export` tool **cannot emit GLB** (formats are `step`/`stl`/`dxf`/`svg` only, and the sandbox strips `open`/`os`/`pathlib`), so Nightjar's design is: the model exports **STEP**, and a **trusted Nightjar-side converter** does STEP → GLB via `build123d.export_gltf`. Both halves of that conversion turn out to be booby-trapped.
- **What (verified on build123d 0.11.1 / cadquery-ocp-novtk, Python 3.12):**
  1. **`import_step`'s tree is not exportable.** Re-importing a STEP assembly yields a tree that is *structurally identical* to the original — same labels, same `wrapped` handles, same volumes, same solid count, and `PreOrderIter` walks it correctly — yet `export_gltf` on it writes a GLB with **0 nodes and 0 meshes**. It fails even for a **single** re-imported solid. Explicitly calling `.mesh(...)` on every node first does **not** help, so this is **not** a tessellation problem — the imported shape objects themselves cannot be serialized.
  2. **`export_gltf` returns `True` anyway.** It returned `True` in *every* case, including both empty-output ones. Its `raise RuntimeError` on write failure is commented out in the source, and the boolean it returns instead is **not** a reliable success signal either. **Checking the return value is NOT sufficient** — an earlier note in `JUNE_better.md` claimed it was; that has been corrected.
- **Mitigation (verified working):** in the trusted converter, **rebuild the tree** from the imported shapes' raw OCCT handles before exporting — wrap each child's `.wrapped` in a fresh `Solid(...)`, carry its `.label` across, and assemble a fresh `Compound`. That round-trips correctly and **preserves the per-part names** the exploded view depends on:

  | approach | GLB nodes |
  |---|---|
  | single re-imported solid | 0 |
  | re-imported tree, as-is | 0 |
  | re-imported tree + explicit `mesh()` | 0 |
  | **rebuilt `Compound` from `wrapped` handles** | **✅ `['planetary_gearset','sun_gear','planet_gear_1']`, 2 meshes** |

- **To do (lands with the Task-5 converter PR):** the converter must (a) rebuild the tree as above, and (b) **validate the emitted GLB bytes** — parse the JSON chunk and assert `nodes > 0` and `meshes > 0` — rather than trusting `export_gltf`'s return value. Without (b) a regression here ships an empty 3D model that looks like a success.
- **Reproducer (corrected 2026-07-15):** `phase-cad/probes/probe_step_glb_hierarchy.py` (the failure + the fix) and `phase-cad/probes/probe_full_cad_loop.py` (the full mcp `execute → measure → export(step)` → converter loop). **Note:** PR #52 claimed to add these under `research/probes/`, but `research/*` is gitignored (it holds upstream clones), so the file was **silently never committed** — a defect in that PR. They now live under `phase-cad/probes/` (tracked) alongside the CAD env, and the whole pipeline was re-verified headless on 2026-07-15.

---

## NJ-17 — no scheduler daemon: JUNE has no long-lived process that could ever fire a reminder — RESOLVED (Task-6 local scheduler shipped) 2026-07-14

> **Update (Task 6, shipped):** RESOLVED. JUNE now has a long-lived poller — `phase3-ui/src/main/scheduler.ts`
> polls `phase2-odysseus/servers/task_poller.py` every 60 s and fires a desktop `Notification` for each due
> task while the app is open (wired in `phase3-ui/src/main/index.ts` via `startLocalScheduler(pushScheduler)`;
> its availability is surfaced to the UI by `SchedulerBanner`, P2-20). The paid always-on path is
> `telegram-scheduler/`. The "no long-lived host process" structural gap described below is **closed**; what
> remains is NJ-16's live-fire verification (a reminder actually firing on a running instance).

- **Severity:** high for the reminders feature; it is the structural reason NJ-16's dead rows are never noticed.
- **What:** JUNE has **no long-lived host process**. The MCP servers are **stdio** children of the OpenCode engine (they exist only for the duration of a tool call), and the Electron main process runs **no scheduler/poller**. Odysseus upstream *does* ship a scheduler (`research/odysseus/` even has a `test_scheduler_restart_doublefire.py`), but Nightjar runs only the MCP wrappers — **not** Odysseus's Flask/FastAPI app or its scheduler. So even a correctly-written `next_run` would have nothing to act on it.
- **Consequence:** "remind me at 1pm" can be *stored* and can never *fire*. Both halves of Task 6 exist precisely to supply this missing daemon: the **local scheduler** in the Electron main (free tier — notifications while the app is open) and the **always-on server** (paid tier — Telegram delivery with the laptop closed).
- **To do:** Task 6. Closes together with NJ-16.

---

## NJ-16 — `pim_server.task_create` writes DEAD rows: no `next_run`, and nothing polls them — reminders silently never fire — FIX IMPLEMENTED (the dead-rows half; the poller is NJ-17 / Task-6 PR 15) 2026-07-14

> **Update (PR #62):** the **dead-rows half is fixed.** `task_create` now computes a real
> `next_run` from schedule + time via a pure, unit-tested `schedule_backend.compute_next_run`
> (once/daily/weekly/monthly, UTC), and rejects an unschedulable request instead of writing a
> corpse. Added `task_due(now)` (polls the `ix_scheduled_tasks_due` index) and
> `task_mark_fired(id, now)` (advances a recurring task's `next_run` from its fire slot,
> completes a `once`), plus a startup migration that heals existing `active`+`next_run IS NULL`
> rows (backfills `next_run`, or completes a dead past-`once`). Verified offline:
> `schedule_backend.py` self-test (15 next_run cases) + `test_pim_tasks.py` (migration heal,
> `task_due`, recurring-advance, once-completes). **Still open:** nothing *polls* `task_due`
> yet — that's the missing daemon (**NJ-17**), supplied by the local scheduler (Task-6 PR 15,
> free tier) and the always-on server (Task-6 PR 17, paid). NJ-16 graduates to RESOLVED when a
> reminder actually fires on a running instance.

> **Update (Task 6, shipped):** the poller now **exists** — `phase3-ui/src/main/scheduler.ts` polls `task_due`
> via `task_poller.py` every 60 s (see NJ-17), so the "nothing polls `task_due` yet" line above is superseded.
> NJ-16 now remains open **only** on the rule-6 live-fire check: a reminder actually firing on a running instance.

- **Severity:** high — it is a **silent** failure. The tool returns `{"id", "name", "schedule"}` and the model cheerfully tells the user the reminder is set. Nothing ever fires.
- **Root cause:** `phase2-odysseus/servers/pim_server.py` `task_create` inserts a `ScheduledTask` with `status="active"` but writes only `name`/`prompt`/`task_type`/`schedule`/`scheduled_time`. It never computes **`next_run`** — even though `ScheduledTask.next_run` is a real, **indexed** column (`core/database.py`) that exists exactly to be polled. It also leaves `scheduled_date` (the "once" case) and `scheduled_day` (weekly/monthly) `NULL`, so the row does not even carry enough information to derive a fire time later.
- **Compounding:** nothing polls the table at all (see **NJ-17**), so the dead rows are never surfaced. `task_list` happily lists them as `active`, which makes the failure look like success from every angle.
- **To do (Task 6, first PR):** compute a real `next_run` on create (for `once`/`daily`/`weekly`/`monthly`, honoring the user's timezone → stored UTC), add `task_due` / `task_mark_fired` so a scheduler can claim and advance jobs, and migrate the existing dead rows. Unit-test the `next_run` math offline. Closes together with NJ-17.

---

## NJ-15 — latent: Odysseus's role-based endpoint resolver (email-AI path) is cloud-capable via settings-pointer / OAuth / Tailscale and leaks "Odysseus" branding on OpenRouter — FLAGGED (dormant; not activated by the provider-selection work) 2026-07-11

> **Update 2026-07-14 (PR #51 — email parked for v1):** this is now **more** dormant, not less. The entry below notes the path was gated by the assistant agent allowing only `list_emails`/`send_email`; **both of those allows have since been removed**, the research agent's `send_email` allow is gone, and the `odysseus-email` MCP server is `enabled: false` — so the `ai_draft_email_reply` tool that reaches this resolver is unreachable **and its server is not even spawned**. Re-check this entry when email is activated for v2; the caveats below (unconfigured creds, Gmail needing an app password, creds stored in plaintext config rather than encrypted like BYOK keys) are all still open and must be resolved *together* with the permission flips.

- **Severity:** low — **dormant**. Surfaced by the provider-selection audit + close-out review (CLAUDE.md rule 7: flag, don't silently fix or ignore). Not reachable in the shipped config.
- **What:** `research/odysseus/src/endpoint_resolver.py` has its OWN backend-selection machinery, separate from Nightjar's five capabilities: `resolve_endpoint(role)` picks a `ModelEndpoint` by a settings **pointer** (`{role}_endpoint_id` → `utility_` → caller fallback → `default_`), with fallback **chains** (`*_model_fallbacks`) and a **second** vision resolver (`resolve_vision_fallback_candidates`). It is reached by the `odysseus-email` `ai_draft_email_reply` MCP tool (`email_server.py`), and cloud routing there can come from three mechanisms the capability model doesn't cover: a static DB `api_key`, a **session-backed OAuth** credential (`provider_auth_id` → ChatGPT-subscription / Copilot, `resolve_endpoint_runtime`), and **Tailscale** host remap (`resolve_url` → `tailscale status` fallback). It also hardcodes OpenRouter branding `HTTP-Referer: https://github.com/pewdiepie-archdaemon/odysseus` + `X-OpenRouter-Title: Odysseus` in `_provider_headers`/`build_headers` (identity-rule violation, relates to **NJ-1**).
- **Why it's dormant (not a live leak):** the assistant agent's permission map denies the AI-email tool (`"*": "deny"`, only `list_emails`/`send_email` allowed), AND Nightjar never seeds `utility_`/`default_endpoint_id` (only `settings.image_model` is seeded), so these resolvers return "no endpoint configured" rather than routing anywhere. It is latent machinery, not an active path.
- **Mitigation already in place:** Nightjar's new cloud paths (research/vision, PR #43/#44) call `llm_call_async` / OpenAI-compatible endpoints **directly** with pre-set **Nightjar** attribution headers, so they never emit the Odysseus branding and never go through this resolver.
- **To address (when/if the AI-email path is enabled):** either fix `_provider_headers`'s OpenRouter branding **as an odysseus patch** under `phase2-odysseus/odysseus-patches/` (the submodule stays a clean upstream mirror — do NOT edit `research/odysseus/**` directly), and route the email-AI backend through the same explicit per-capability selection; or keep the tool permission-denied. Confirm on a live stack per rule 6 before enabling.

## NJ-14 — explicit per-capability Online/Offline + provider selection replaces all implicit local-vs-cloud precedence — FIX IMPLEMENTED (runtime-verify pending for live cloud/GPU paths) 2026-07-11

- **Severity:** medium — a cross-cutting behavior change to a safety/privacy surface (PRs #39–#45). Closes a real privacy leak (below) and removes two contradictory hidden precedences.
- **What changed:** every capability (chat/coding, image, deep research, vision, browser) now runs **Offline/local by default**; going **Online** and picking a provider is an explicit, persisted per-capability choice (BYOK "Capabilities" panel). A stored BYOK key **alone** never routes any capability to the cloud.
  - **Image gen:** removed the `OpenAI > OpenRouter` precedence (`applyImageEndpoint` now seeds only the explicitly-chosen backend; pure `resolveImageBackend`).
  - **Browser agent (privacy leak fixed):** previously routed to the cloud whenever ANY OpenRouter/OpenAI key was stored (`PREFER` defaulted to `byok`, MCP inherits `NIGHTJAR_BYOK_*`) — silent cloud egress that defeated the `byok.ts` scoping guarantee. Now defaults to local; only an explicit `NIGHTJAR_BROWSERUSE_PROVIDER` routes cloud.
  - **Deep research & vision:** gained **new** explicit cloud paths (were local-only / dead-stub), each with a rule-3 wall-clock timeout; vision's `vision_settings.json` is now aligned to `NIGHTJAR_VISION_MODEL` (source-of-truth fix).
- **Behavior changes to expect (intentional):** (1) **default Offline** — anyone who relied on the old implicit cloud image path picks a provider once; (2) **NJ-6's auto cloud-fallback-when-sidecar-down is removed** — Offline stays Offline (a down local sidecar means image gen has no backend, not a silent cloud call).
- **Close-out review fixes (this PR, #45):** a `restartService("opencode-serve")` **race** (now that `capabilities:set` for browser/research/vision joins `byok:set/remove` as an un-serialized restart caller) → made single-flight + coalesced like `reconcileImageEndpoint` (regression test in `test-supervisor-restart.ts`); stale comments (`services.ts`, `index.ts`) that described the removed cloud-fallback were corrected. Residual (low): a rare seed/unseed subprocess failure can transiently leave zero (or, if an unseed fails, a stale) image row — logged, and healed by the next reconcile.
- **To close (rule 6, needs a real key / GPU / Ollama):** for EACH capability set Online→pick a provider→exercise it and confirm the chosen provider is used; set Offline and confirm on-device. Critically: **with an OpenRouter/OpenAI key set but Browser = Offline, run a browser task and confirm it uses the LOCAL model (not cloud)** — the leak is closed. Verified headless so far: all four backend resolvers + the leak-closure/consistency review (0 findings) + the restart coalescing; the live cloud round-trips are not drivable headless.

## NJ-12 — supervisor: a service that misses its readiness window is frozen "unhealthy" and never re-probed, silently defeating the NJ-6 local-first image fallback — FIX IMPLEMENTED (runtime-verify pending) 2026-07-09
- **Severity:** medium — surfaced by the **post-merge independent audit** of the Phase 0–6 work (a control-flow gap confirmed by code read, not a live repro). GPU-only manifestation, silent, self-heals on app restart.
- **Symptom:** on a machine where the local diffusion sidecar's ~6GB cold GPU load exceeds `readyTimeoutMs` (180s — contended/cold GPU or slow disk), image generation stays pinned to the **cloud/BYOK** endpoint (or none) even though a fully-working local model is up and serving on :8100 — the exact offline local-first guarantee NJ-6 was built to protect.
- **Root cause:** in `phase3-ui/src/main/supervisor.ts` `spawn()`, the readiness loop's **timeout path** set the service `"unhealthy"` and returned **without** starting any probe. `beginHealthWatch` — the only thing that flips `unhealthy → healthy` — was reached only from the healthy-within-timeout path, the adopt path, and `restartService` (never invoked for `diffusion-server`; only `opencode-serve` is restarted). So once the model finished loading and began serving, nothing re-probed it: its state stayed `unhealthy` indefinitely, the supervisor status callback's `diffHealthy` never went false→true, and the NJ-6 transition reconcile (`index.ts`) never fired. The `index.ts` comment even explicitly *promised* to cover "a slow ~6GB cold load finishing past the readyTimeout" — the one case it did not.
- **Fix (PR #37):** the timeout path now starts a new **`beginRecoveryWatch(m)`** — a *passive* recovery probe that flips `unhealthy → healthy` once the service finally answers, then hands off to `beginHealthWatch`. It deliberately does **not** kill/restart on continued misses (unlike `beginHealthWatch`, whose 3-miss SIGKILL would restart the slow load from scratch → a doom loop): the process is alive and may just need more time, and the child's own `--timeout` + its `exit` handler still own the crash-restart (rule 3). It re-checks its guards after each `await` so a `stop()`/`restartService` landing mid-probe is not clobbered, and shares the `healthTimer` slot so both cancel it. General by design — **any** slow-loading managed service now self-heals after a readiness timeout instead of freezing.
- **To close (rule 6):** on a real **GPU box** where the Z-Image-Turbo cold load exceeds 180s (or force it by lowering the diffusion `readyTimeoutMs`), confirm the sidecar recovers to `healthy` once it starts serving and image gen switches from cloud back to **local** with no app restart.

## NJ-11 — image endpoint: seeded model was pinned but the resolver probed anyway; local diffusion server has no per-generation wall-clock cap — B13 FIXED / B3 OPEN 2026-07-09
- **Severity:** low — surfaced while wiring the NJ-6 local-first image backend.
- **B13 (FIXED — this PR, via `nightjar-odysseus.patch`):** `phase2-odysseus/seed_image_endpoint.py`
  pins the model (`ep.pinned_models = [model]`, commented "so it resolves without probing"),
  but Odysseus's `_resolve_model` (`research/odysseus/src/ai_interaction.py`) ignored pinned
  models for OpenAI-compatible endpoints and hit `/v1/models` on **every** image generation —
  an extra round-trip that hard-fails on the 5s probe timeout or a rate limit. The resolver now
  consults pinned models first (getattr-guarded, no-op without pins), resolving with no network
  call. (Setting `cached_models` alone was insufficient — it's only read when `build_models_url`
  is falsy, which never happens for OpenAI/OpenRouter.)
- **B3 (OPEN — follow-up):** `research/odysseus/scripts/diffusion_server.py` has **no server-side
  per-generation wall-clock cap** (rule 3) — a hung/looping pipeline `__call__` is bounded only by
  the client httpx read-timeout (300s) / the opencode MCP timeout, not server-side. Add a
  `--gen-timeout` backstop (run the pipeline call under a thread with a hard abort) when the local
  diffusion backend is driven on real GPU hardware.
- **Scheduled:** B13 ships with the NJ-6 local-image PR; B3 lands with the GPU-hardware verification
  of the local diffusion backend (it's GPU-only code — can't be exercised headless, per rule 6).

## NJ-10 — permission: a genuinely-undelivered abort leaves no in-UI re-abort control (rare) — FIX IMPLEMENTED (runtime-verify pending) 2026-07-09
- **Resolution (PR #31, Phase 2):** a persistent per-session **Stop** control in the composer, backed by `abortSession(id)` in `PermissionContext` — the session you are **viewing** is always interruptible even with no ask shown; on a failed abort `busy` stays true so Stop remains, and `client.abort()` is 10s-bounded (a 404 = already gone → clears). **To close (rule 6):** drive a coding edit so the ask fires, simulate a dropped abort, confirm the ask clears, `busy` stays, and the red **Stop** stays clickable.
- **Caveat (audit, not a regression):** the Stop control lives inside each tab's `ChatSurface`, so it renders for the session you are **viewing** but not for a **background** tab's session (its screen is `display:none`). A background session running with no pending ask therefore can't be stopped without switching to its tab — the global permission **Abort** still surfaces for any background *ask*, so only a running-with-no-ask background session is affected. Session-scoped by design (each Stop calls `abortSession(id)` for its own slot); left as-is. Revisit if a global "stop any running session" affordance is wanted.
- **Severity:** low — only on an actual `POST /session/:id/abort` failure (uncommon
  against the loopback engine), and it does **not** hard-wedge (the composer stays
  usable because `abort()` clears the session's `busy` before the POST).
- **Detail:** in the Stage-4 multi-session permission **queue** (`PermissionContext`),
  a failed `reply()` re-surfaces the ask only when it is genuinely still pending —
  reconciled against the `permission.replied` SSE stream (`repliedIds`) so a lost-ACK
  doesn't create a "zombie" already-answered ask. `abort()` **cannot** use that
  signal: the server resolves an aborted permission by cancelling the fiber and
  **silently deleting the pending permission with no `permission.replied` event**
  (confirmed in the vendored OpenCode source). With no way to tell a lost-ACK
  (already aborted) from a genuinely-undelivered abort, re-surfacing on abort would
  risk a zombie ask masking a live cross-session ask — worse than the residual. So
  abort deliberately does not re-surface: a genuinely-dropped abort leaves the
  session paused server-side with no in-UI re-abort control until reload/reconnect.
- **Root cause:** at-most-once semantics over an unreliable POST, with no engine-side
  ack/idempotency for the "abort resolves a pending permission" path.
- **Fix ideas:** (a) have the engine emit a `permission.replied`-family event when an
  abort cancels a pending permission — then the same reconciliation `reply()` uses
  would cover abort; (b) client-side, add a persistent per-session stop/interrupt
  control (independent of the ask) so a paused session is always abortable even when
  no ask is shown.
- **Scheduled:** documented tradeoff introduced with the multi-session permission
  queue (`feat/ui-redesign-sessions`, PR #23); recorded inline in `PermissionContext.abort()`.
  Revisit if the engine gains an abort-resolved permission event.

## NJ-9 — Create-Image recovery resends the raw prompt as a plain chat message (loses the generate_image directive) — FIX IMPLEMENTED (runtime-verify pending) 2026-07-09
- **Resolution (PR #32, Phase 3):** fallback/rate-limit offers now carry a `SendKind` (`"chat" | "image"`); the local-retry path re-dispatches an image offer through `createImage()` (which re-wraps the `generate_image` directive) instead of the plain `send()`, so an image request stays an image request on recovery. **To close (rule 6):** force a cloud image turn to fail (bad key / rate limit), click **Retry on local model**, confirm it regenerates an *image* — not a chat reply describing one.
- **Severity:** low — only when a **cloud** image-generation turn fails via
  `session.error`, and the local model *may* still opportunistically call the tool.
- **Detail:** `SessionsContext.createImage()` stores the **raw** description in
  `refs.lastSent`, while the prompt actually sent is the wrapped *"Use the
  generate_image tool…"* directive (never stored). If the image turn fails on a cloud
  model (`session.error` → `handleSessionError`), the recovery offer's `text` is the
  raw prompt; clicking **Retry on local model** runs `send(…, prompt)` and dispatches
  the bare prompt as an **ordinary chat message**, so the model chats *about* the
  prompt instead of regenerating the image.
- **Root cause:** the recovery offer carries no *kind* (chat vs image); `lastSent` is
  the raw prompt, not the directive, and retry always uses the plain `send` path.
  **Pre-existing** — the identical wiring existed in the former single-session
  `ChatContext`; the PR #23 adversarial review surfaced it (did not introduce it).
- **Fix idea:** tag the recovery offer with the send kind (`chat` | `image`) and
  re-dispatch an image retry through `createImage()` (which re-wraps the directive),
  or store the directive-wrapped text for image sends.
- **Scheduled:** small follow-up; natural home is the chat-attachments / image-gen
  path (relates to **NJ-6**/**NJ-7**). Not a blocker for the multi-session PR.

## NJ-8 — live-preview: large single-file artifacts truncate on the local 4B — MITIGATED (runtime-verify pending) 2026-07-09
- **Resolution (PR #30, Phase 1):** this is a local-model *capacity* limit, not a bug, so it's **mitigated** rather than closed. The coding prompt now steers the local 4B toward **concise, multi-file** writes (each under budget); an opt-in `NIGHTJAR_DESIGN_PROFILE=1` raises the predict/context caps **and** the matching wall-clock timeouts **together** and each stays finite (rule 3 — never the global default, `services.ts`); a truncated `write` still fails cleanly (empty part → `error`, no partial file). **To close (rule 6):** on a real local 4B ask for a large single-file page → confirm it emits multi-file (or a clean error), never a silent/garbage artifact; a stronger BYOK model renders big artifacts directly.
- **Severity:** low — the live-preview panel *mechanism* (mirror write/edit tool-call content → sandbox → loopback server → markdown render + download) is implemented and verified **up to but NOT including the iframe render** (`phase3-ui/test-preview-e2e.ts`: coffee-shop HTML + markdown doc, 5/5; `test-preview-server.ts` 18/18). Only the model's ability to emit a *big* artifact in one tool call is limited.
- **⚠ Verification-scope correction (2026-07-20, rule 8).** This entry previously claimed the mechanism was "verified end-to-end" **including the iframe**. That was a **false green**: `test-preview-e2e.ts` asserts via a Node-side `await fetch(url)`, which has **no CSP enforcement**, and the test's own header says "The only piece NOT covered here is the literal Electron `<iframe>` pixels (needs a display)." The iframe render was therefore never verified — and it was in fact **broken the entire time** by the missing `frame-src` (see **NJ-39**). A proxy (a Node fetch) had been standing in for the real path (a Chromium frame load), which is exactly the failure mode rule 8 names. Corrected so the next person to touch preview does not again assume the render path is covered by the existing suite and skip the GUI check.
- **Detail:** the coding agent writes files via its `write` tool. The local **Qwen3-4B** is capped at `--predict 2048` tokens (a rule-3 safety backstop, `services.ts`). An elaborate single self-contained page can exceed that, so the `write` tool-call JSON is **truncated → the part goes `pending → error` with empty `input`** (observed). The preview correctly renders nothing for an errored write (no partial/garbage file). A **concise** page or a **markdown doc** fits the budget and renders fine; so does any artifact on a **stronger BYOK/OpenRouter model**.
- **Mitigations in place:** the coding-mode system prompt steers previewable artifacts under a (gitignored) `preview/` dir **using the write tool** (not inline), and toward concise output; multi-file output (separate `index.html`/`style.css`/`script.js`) also keeps each write within budget.
- **Fix ideas:** encourage multi-file/concise generation more strongly; raise `--predict` only behind a "design" profile (never the global default — rule 3); rely on a BYOK model for large artifacts.
- **Scheduled:** revisit with the full UI redesign (AUDIT §10 Step 7) and/or a stronger local model; documented behavior of the live-preview feature (`feat/live-preview-panel`).

## NJ-7 — attached-image analysis is model-dependent (local needs Ollama gemma3; Create-Image reliability) — FIX IMPLEMENTED (code-wired; needs Ollama+gemma3 to verify) 2026-07-09
- **Resolution (PR #33, Phase 4):** the composer now gates on a **vision-readiness** probe — `useVisionReadiness()` returns `boolean | null` (null = status not yet known), keyed on `ollama === "running"`, and only *blocks/warns* on an explicit `=== false` so it never false-warns before status arrives; the local route saves the image + hints the path and `nightjar_analyze_image` is permission-granted (assistant mode); `vision.py`'s `_local_vision_blocker()` probes the active model and fails **open** (skips cloud/`/`-prefixed models). Create-Image reliability improved via a retry-once. **To close (rule 6):** with **Ollama + `gemma3:4b`** running, attach an image → analysis works; with it stopped → composer warns (not silently fails); text docs work on any model. The gemma3 bundling is an installer task (Step 11).
- **Severity:** low — the attach-and-send *mechanism* (paste/drag/browse → file part → agent) works; only the downstream image *analysis* is conditional.
- **Detail:** the local Qwen3-4B is **text-only**, so an attached image is only *seen* directly by a **cloud vision model** (BYOK OpenAI/Anthropic/Google). For the **local** route the composer saves the image to disk + hints the path, and `nightjar_analyze_image` is now permission-granted (assistant mode) — but that tool needs **Ollama + `gemma3:4b`** installed/running; without it the call errors. Text docs (`.txt`/`.md`/…) are read server-side and injected as text, so they work on **any** model.
- **Also:** the **Create Image** button uses a strong directive (OpenCode exposes no client-side `tool_choice`), so a small local model may occasionally not call `generate_image` on the first try.
- **Fix idea:** bundle/guide the `gemma3:4b` install in the installer (Step 11); optionally ship a vision-capable local model (mmproj); if OpenCode adds forced tool-choice, wire Create-Image to it directly.
- **Scheduled:** the gemma3 dependency → installer (Step 11); otherwise documented behavior of the chat-attachments feature (`feat/chat-attachments`).

## NJ-6 — image_gen: cloud path enabled (OpenAI + OpenRouter); local-first backend now code-wired — FIX IMPLEMENTED (code-wired; needs GPU+Z-Image-Turbo to verify) 2026-07-09
- **Resolution (PR #34, Phase 5):** the **local-first/offline** backend is now wired end-to-end (previously the remaining gap). `services.ts` adds a best-effort `diffusion-server` sidecar, launched **only** when both the model dir (`~/models/Z-Image-Turbo` with `model_index.json`) and the GPU venv exist (mirrors the ollama gate), wall-clock-gated by `readyTimeoutMs:180000` (rule 3 at process level); `index.ts` picks **local-first** (only unseeds the cloud endpoint after a *confirmed* local seed) and reconciles on diffusion-server health transitions. Two odysseus patch fixes ride along: **B13** (`_resolve_model` consults pinned models → no `/v1/models` probe per generation) and **B12** (`response_format=b64_json` + retry-without-param). **To close (rule 6):** on a real **GPU box + Z-Image-Turbo pulled**, generate → served locally (offline); stop the local server → falls back to cloud (with a BYOK key). Residual **B3** (no server-side per-generation cap) tracked under **NJ-11**. Installer model-pull is Step 11.
- **Severity:** medium (was: does not work at all). Chat→image now works via a **cloud**
  endpoint once seeded — either **OpenAI** or **OpenRouter** (auto-wired from the BYOK key,
  OpenAI takes precedence); the **local-first/offline** backend is still pending.
- **✅ Progress (2026-07-06):**
  - **Gap 1 FIXED** — `odysseus-image_generate_image` granted (`"ask"`) in **assistant** mode
    (`opencode.json`), so the agent can call it (still approval-gated, per rule 1).
  - **Gap 2 — cloud endpoint mechanism added + verified.** `phase2-odysseus/seed_image_endpoint.py`
    registers an OpenAI-compatible image endpoint in Odysseus's `model_endpoints` DB (key
    Fernet-encrypted at rest), enables `image_gen_enabled`, and sets `image_model`. **Verified
    end-to-end** by `phase2-odysseus/test_image_gen.py` against a **mock** OpenAI endpoint: the
    real `image_gen_server.py` path resolved the endpoint → POST `/images/generations` → b64
    decode → **wrote a real PNG** → returned a link (PASS).
  - **Gap 2b — auto-wired from the single BYOK key (no separate script).** The main process
    (`phase3-ui/src/main/index.ts`) now runs the seed automatically whenever an **OpenAI**
    key is set/removed in the BYOK panel (`byok:set`/`byok:remove`, passing the decrypted key
    via env → `NIGHTJAR_IMAGE_MODEL=dall-e-3` by default), and re-seeds any stored key at
    startup. So pasting the OpenAI key is the only step — image gen, chat, etc. all work from
    it. Verified end-to-end (mock OpenAI): set→endpoint row (encrypted key decrypts) + image
    generated; remove→endpoint deleted. (`test_image_gen.py`, 4/4.)
  - **Gap 2c — OpenRouter added as a second cloud backend (2026-07-07).** Image gen can now
    also run through **OpenRouter's Unified Image API** (`POST https://openrouter.ai/api/v1/images`,
    request `{model, prompt, …}` → response `{data:[{b64_json}]}` — same shape OpenAI uses, only
    the path differs: `/images` vs `/images/generations`). `image_gen_server.py` picks the dialect
    from the endpoint host (`_image_api_style()`; override `NIGHTJAR_IMAGE_API_STYLE` for tests) and
    relaxes the DALL·E-3 size clamp for non-OpenAI models (FLUX/Seedream/etc). `index.ts` now
    reconciles **one** active image endpoint from the stored BYOK keys with **OpenAI taking
    precedence** — an OpenRouter key wires image gen only when **no OpenAI key** is present
    (default model `openai/gpt-image-1`; override `NIGHTJAR_IMAGE_OPENROUTER_MODEL`). `seed_image_endpoint.py`
    is now provider-neutral (`NIGHTJAR_IMAGE_API_KEY`, back-compat `OPENAI_API_KEY`). **Verified
    end-to-end** against a **mock OpenRouter** endpoint: seed→`/images` POST (never `/images/generations`)
    →b64→PNG→link, host-dialect detection (openrouter.ai→openrouter, api.openai.com→openai),
    encrypted-key row + unseed. (`test_image_gen_openrouter.py`, 7/7; `test_image_gen.py` still 4/4.)
  - ⚠️ **Not yet verified against real OpenAI / real OpenRouter** (no key in this environment; `gpt-image-1`
    needs OpenAI org verification — `dall-e-3`, the auto-wire default, works without). The full
    live **paste-key → chat → approval → image** flow needs a running-app + real-key check, for
    both a real OpenAI key and a real OpenRouter `sk-or-…` key (the Electron `reconcileImageEndpoint`
    precedence + subprocess seed wasn't driven headless here — mock-verified only).
  - **Still OPEN:** the **local-first/offline** backend (Z-Image-Turbo via `diffusion_server.py`)
    is deferred to **Step 11** (installer model-download) as planned — the cloud path above is
    an interim opt-in that sends prompts off-machine.
- **Severity note (original, for history):** image generation **did not work at all** — two
  independent gaps below.
- **Gap 1 — no mode can call the tool.** All three agent modes in `opencode.json`
  (assistant/coding/research) are deny-by-default (`"*": "deny"`) and none whitelists
  `odysseus-image_generate_image`, so the agent is **not permitted to invoke it even when the
  user asks in chat** (correct per rule 1 — the tool was simply never added to an allow-list).
- **Gap 2 — no image endpoint configured (not local-first).** The `odysseus-image` MCP
  (`research/odysseus/mcp_servers/image_gen_server.py`) is API-based and resolves its endpoint
  from **Odysseus's own `ModelEndpoint` DB — NOT Nightjar's BYOK keys** — which is empty, so
  even a permitted call returns "No image model found." As shipped it would only work by
  pointing at **cloud** OpenAI (`gpt-image-1`/`dall-e-3`), contradicting local-first.
- **Root cause:** the tool was never granted to a mode, and the local `diffusers` server
  (`research/odysseus/scripts/diffusion_server.py`) exists but is launched/wired nowhere with
  no `image_model` configured.
- **Fix idea (Step-3 audit recommendation):** (a) grant `odysseus-image_generate_image` to a
  mode (e.g. assistant, `"ask"`); (b) run `diffusion_server.py --model Tongyi-MAI/Z-Image-Turbo`
  (Apache-2.0, ~6 GB VRAM) as a managed sidecar and register it as the Odysseus image endpoint;
  pull the model in the installer's model-download step. **Never** default to FLUX.1-dev / SD 3.5
  (non-commercial / community-licensed). Full audit + license table:
  `NIGHTJAR_LICENSE_AND_ATTRIBUTION.md` → "Image-generation model licenses".
- **Scheduled:** small implementation task — natural home is the **one-command installer**
  (Step 11, model download) + a one-line `opencode.json` permission grant. The license audit
  itself (Step 3) is ✅ done.

## NJ-5 — BYOK key change can't be applied to an *adopted* opencode-serve — FIX IMPLEMENTED (runtime-verify pending) 2026-07-09
- **Resolution (PR #35, Phase 6):** the supervisor now **captures the external PID at adoption** via a cross-platform `pidOnPort()` (linux `ss`→`lsof`→`fuser`, darwin `lsof`, win32 `netstat`; `execFile` with a 2s timeout + `windowsHide` per rule 3), returning a PID **only when exactly one distinct listener is found** (rule 4 — never an ambiguous kill target). `restartService()`'s adopted branch **re-queries the current listener at restart time** (no stale PID), then SIGTERM→wait→SIGKILL→wait→bail-if-still-held, else re-spawns with the new `NIGHTJAR_BYOK_*` env — so a BYOK change now applies to an adopted engine. **Known tradeoff (rule 7):** restarting an adopted engine we didn't spawn can orphan MCP children it started; documented inline in `supervisor.ts` + the PR. **To close (rule 6):** leave a stray `opencode serve` on :4096, start June, change a BYOK key → confirm the adopted engine restarts and the new key takes effect.
- **Hardening (PR #37, audit):** the adopted-restart SIGKILL now **re-queries `pidOnPort` immediately before killing** and fires only if the port's sole listener is **still the same PID** — closing a narrow window where an external respawn + OS PID-recycle during the SIGTERM wait could have signalled an innocent process (rule 4). If the PID changed, it skips the kill and the honest "didn't release" surface reports instead.
- **Severity:** low — only affects the adopt path (a `opencode serve` already on
  :4096 when Nightjar starts, e.g. a leftover/dev instance); the normal path
  where Nightjar spawns the engine is unaffected.
- **Symptom:** adding/removing a cloud key does not take effect; the key stays
  inert until Nightjar (and the engine) is fully restarted.
- **Root cause:** the supervisor adopts a healthy service by *port probe* and
  never captures the external PID, so `restartService()` has no process to stop
  and cannot re-exec it with the new `NIGHTJAR_BYOK_*` env.
- **Mitigation shipped (feat/byok-cloud-keys):** `restartService()` now detects
  this instead of spawning a colliding second engine that the stale one would
  shadow — it surfaces an "adopted / can't apply" state + health-strip detail
  telling the user to restart Nightjar. So the failure is honest, not silent.
- **Fix idea:** capture the PID at adoption (port→PID lookup) so adopted services
  can be cleanly restarted, or offer to take over the port.
- **Scheduled:** **Step 15 (real-hardware QA)** in the `AUDIT_REPORT.md` §10 confirmed
  order — the adopted/leftover-engine scenario is exercised during multi-process
  real-hardware testing, and the supervisor lifecycle fix lands with it.

## NJ-4 — Renderer SSE stream does not auto-reconnect after an engine restart — FIX IMPLEMENTED (runtime-verify pending) 2026-07-08
- **Severity:** medium — chat silently stops working (dead stream + stale session
  id) until a full window reload.
- **Symptom:** after `opencode-serve` restarts, the renderer keeps its original
  one-shot SSE subscription and session id; new prompts target a session that no
  longer exists and no events arrive.
- **Root cause:** the connect `useEffect` in `App.tsx` subscribes exactly once and,
  on stream close, only calls `setStatus("stream closed…")` — it never re-enters
  the connect/retry loop. Predates BYOK; the supervisor's crash→auto-restart of
  opencode-serve already triggered it.
- **Mitigation shipped (feat/byok-cloud-keys):** the BYOK-triggered restart now
  forces a reconnect (recreate session + resubscribe) via a `reconnectTick`. The
  **crash-restart** path is still uncovered.
- **Fix idea:** on SSE close, re-enter the bounded connect/retry loop (the same one
  used at startup) instead of parking on a status string.
- **Fix (implemented — redesign Stage 3, 2026-07-08, `feat/ui-redesign-nj4`):** in the
  reworked connection layer (`phase3-ui/src/renderer/src/context/ConnectionContext.tsx`),
  the single SSE subscription now re-enters the bounded connect/retry loop on **any**
  stream termination — a clean close (`.then`) OR an error (`.catch`) — not just the
  BYOK restart; both bump the same `reconnectNonce`, recreating the session + resubscribe.
  A 1s settle floor plus the loop's existing 2s `listAgents` backoff bound flapping if the
  engine crash-loops; an aborted-guard prevents a reconnect fired after teardown so it
  never double-connects.
- **Hardening (PR #31, Phase 2):** the multi-session refactor added a **superseded-run guard**
  so a reconnect that fires after a newer session/subscription has taken over cannot deliver
  stale SSE events into the live session, plus the stale-ask prune in `PermissionContext`.
  Reconnect is now covered on **both** the BYOK-restart and the crash-restart paths.
- **Correction + hardening (PR #37):** an earlier version of this entry claimed "`gcSessions`
  won't abort a still-busy session" — that was **backwards**. B9 (`SessionsContext.tsx`)
  *deliberately* aborts a still-busy **unbound** session before forgetting it, so a mid-turn
  session dropped by a slot rebind can't wedge un-droppable server-side (it has no Stop control
  once unbound). That behavior is correct; the doc line was stale. The audit also found B9 read
  "busy" only from the `sessionsRef` mirror (which can lag a send by one flush) while its sibling
  B3 reap uses a synchronous `lastSent` belt — B9 now uses the **same belt**, so a session GC'd in
  the same tick it sent is still aborted, not forgotten mid-turn.
- **Verification:** ⚠️ **PENDING** — implemented in a headless env with no reachable
  opencode-serve, so the actual kill-engine → auto-resubscribe → working-prompt path was
  NOT driven end-to-end (CLAUDE.md rule 6). Drive it on a live stack before moving this to
  RESOLVED.

---

## ✅ RESOLVED

## NJ-13 — BYOK: the `NIGHTJAR_BYOK_ALLOW_INSECURE` test hatch still threw on a keychain-less box (saving any key failed) — FIXED 2026-07-09
- **Severity:** medium (test/dev only) — with the hatch **on**, saving *any* cloud key (repro'd with OpenRouter) failed with `Error while encrypting the text provided to safeStorage.encryptString. Encryption is not available.`, so BYOK could not be exercised at all on a machine without an OS keyring (WSL2 / headless Linux). Found during manual testing.
- **Root cause:** `setKey()` in `phase3-ui/src/main/byok.ts` treated the `ALLOW_INSECURE` branch as *log-a-warning-then-continue* — it fell through to an **unconditional** `safeStorage.encryptString(trimmed)`. The code (and its comments) assumed Electron's `safeStorage` silently falls back to a `basic_text` backend when no keychain is present; it does **not** — with `isEncryptionAvailable() === false`, `encryptString` **throws**. So the hatch only ever "worked" on a box where a keyring happened to be present (masking the bug since the first BYOK commit); it wasn't a UI-redesign regression, just first surfaced now under real keychain-less manual testing.
- **Fix:** `setKey()` now routes on `isEncryptionAvailable()`: keychain present → `safeStorage.encryptString` tagged `enc:`; keychain absent + `ALLOW_INSECURE` → store the key with a clearly-labeled **base64 obfuscation** tagged `insec:`, **bypassing safeStorage entirely** (never calling the throwing API). `decrypt()` routes by tag (`insec:` → base64 decode with no safeStorage; `enc:`/legacy-un-prefixed → `decryptString`), so the key round-trips and `envForOpencode()` injects `NIGHTJAR_BYOK_OPENROUTER` into the engine. Misleading `basic_text` comments corrected.
- **Verification:** `phase3-ui/test-byok-insecure.ts` (13/13) mocks `electron` to reproduce the exact throw (`isEncryptionAvailable()=false`, `encryptString` throws) and proves: save no longer throws, the key round-trips, `listStatus` reports it present, and `envForOpencode` injects it — **plus** the real-keychain `enc:` path and legacy un-prefixed back-compat still work, and an undecryptable ciphertext is still reported absent. ⚠️ The full **in-app** paste-key → save → live OpenRouter **cloud call** was not driven here (headless, rule 6) — but injection uses the same `{env:NIGHTJAR_BYOK_*}` path the encrypted flow already uses.

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
