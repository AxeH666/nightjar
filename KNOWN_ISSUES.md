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
- **Stray CAD test output in the engine workspace** (untracked `*.step`) — now covered by the `engine-workspace/*.step` ignore rule added when the workspace moved out of `phase2-odysseus/` (PR A). No action needed unless you want the old `phase2-odysseus/workspace/` directory cleaned up before PR G removes it.

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

## NJ-81 — MCP servers' stderr is still cp1252 on Windows (latent, not live) — OPEN 2026-08-05

- **Flagged while fixing NJ-79 (rule 7 — filed, scope deliberately not expanded.)** The
  `PYTHONIOENCODING=utf-8` fix reaches only sidecars the SUPERVISOR spawns. The MCP servers are
  spawned by **opencode**, so they don't get it.
- Their **stdout is already safe** — the `mcp` library wraps it in
  `TextIOWrapper(..., encoding="utf-8")` (verified in the installed package), which is why the
  JSON-RPC transport has never corrupted. Their **stderr is not**, and that is where their logs go.
- **Currently latent, not live:** a scan of all 13 servers/backends/pollers found **zero**
  crash-capable `print`/`log` sites (no cp1252-unencodable character in any of them). Nothing
  is broken today.
- **Why it still matters:** nothing prevents it. The next `print("…✓…")` added to any MCP
  server crashes it exactly as NJ-79 crashed the wake daemon — only on Windows, only when
  spawned rather than run by hand.
- **Fix shape:** the same `sys.stdout/stderr.reconfigure(encoding="utf-8", errors="replace")`
  preamble in each MCP server entry point, or a shared import that does it.

## NJ-80 — sidecar log capture corrupted multi-byte characters split across pipe chunks — FIXED (PR-3) 2026-08-05

- **Found while fixing NJ-79 (rule 7), and it is a DIFFERENT defect** — NJ-79 was the
  *producer* writing cp1252 bytes; this is the *consumer* mis-joining perfectly correct UTF-8.
- `Supervisor.spawn` captured output with `m.logs.push(b.toString())`, decoding each `data`
  chunk independently. Chunk boundaries land wherever the OS pipe buffer decides, so a
  multi-byte UTF-8 character split across two chunks had **both halves** decode to U+FFFD.
- Silent, intermittent, and position-dependent on buffering — it would never reproduce in a
  test that writes a single chunk, which is why it went unnoticed.
- **Fix:** a stateful `StringDecoder` per stream (`node:string_decoder`), which holds an
  incomplete trailing character until the next chunk completes it. **Two** decoders, not one:
  stdout and stderr are independent byte streams, and sharing a decoder splices a partial
  character from one into the other (pinned by a test). Synthesized log lines — e.g. the
  spawn-error message — bypass the decoder entirely, since they are strings, not pipe bytes.
- **Verified by running:** the naive path is asserted to corrupt; the decoder is asserted to
  reassemble at **every** byte offset, and under worst-case byte-at-a-time delivery.

## NJ-79 — the wake daemon could never start under the app: piped stdio on Windows is cp1252, and one emoji in a log line killed it — FIXED (PR-3) 2026-08-05

- **First real-hardware run of the voice path. Reproduced byte-identically, then fixed.**
- Python chooses stdout's encoding from whether stdout is a **console**. A real terminal gives
  `_WindowsConsoleIO` at utf-8; a **pipe** falls back to the locale ANSI codepage — `cp1252` on
  a typical Windows box. The supervisor spawns with pipes. `⚠️` (U+26A0 U+FE0F) has no cp1252
  mapping, so `print()` raised `UnicodeEncodeError`, nothing caught it, and the daemon exited
  before reaching the mic loop — five crash-restarts, then `failed`.
- **This is why it survived every prior test:** run `wake_daemon.py` by hand in a terminal and
  it works perfectly. Only the piped path breaks, so only the app could ever hit it. A
  console-attached test PASSES ON THE BROKEN CODE — the regression test therefore spawns a
  subprocess with `stdout=PIPE, stderr=PIPE` and forces `cp1252`, and a fourth check proves
  the premise by showing the utf-8 case passing while the strict-cp1252 case still raises.
- **TWO failure modes, not one** — this explains the `�` seen alongside the crash:
  - **Crash:** characters with *no* cp1252 mapping (`⚠️`, `→`, `─`, `≥`).
  - **Mojibake:** characters that *are* in cp1252 — the em-dash `—` encodes to the single byte
    `0x97`, which is not valid UTF-8, so the supervisor's decode rendered it `�`. Confirmed
    from the raw bytes. Fixing the encoding repaired both.
- **Fix:** `sys.stdout/stderr.reconfigure(encoding="utf-8", errors="replace")` at the top of
  `wake_daemon.py`, **and** `PYTHONIOENCODING=utf-8` in the supervisor env for both Python
  services. Not redundant: the env covers output emitted *before* the reconfigure runs (an
  import-time traceback) and every other supervisor-spawned sidecar; the reconfigure covers the
  daemon when spawned by something that isn't the supervisor. `errors="replace"` is deliberate
  — **a log line must never be able to kill the process**; strict would just relocate the crash.
- Belt-and-braces: the three *reachable* `⚠️` log sites are now ASCII `WARNING:`. The other
  ~112 non-ASCII characters in the tree were deliberately NOT touched — they are comments and
  docstrings that never reach stdout, and the encoding is the bug, not the characters.
  **Line 181's warning especially**: it exists to explain a DENIED microphone, so on the very
  machine where the mic is denied it would have crashed inside its own explanation.
- Only `wake_daemon.py` had reachable crash sites; see **NJ-81** for the latent MCP exposure.
- **Windows-only** — verified by running: WSL reports `utf-8` for a piped stdout. **A packaged
  build is worse**: no console exists at all, so cp1252 is guaranteed and there is no terminal
  for the traceback to appear in.
- **Verified by running:** the daemon, piped, now reaches `listening (live mic…)` — the line
  it had never printed under a pipe — with zero `UnicodeEncodeError`, and the previously
  mangled `[nightjar-wakeword]` line now shows a correct `—`.
- **Residual (rules 6/8):** the daemon starting *under Electron's spawn* and holding the mic is
  hardware-pending; my reproduction pipes the same code but not through the app.

## NJ-78 — `config.WAKE_WORD` was a knob that lied: zero consumers, and `NIGHTJAR_WAKE_WORD` was inert — RESOLVED (deleted, PR-2) 2026-08-05

- **Found by audit2 (E1), CONFIRMED and strengthened.** `WAKE_WORD` had **zero** consumers
  anywhere in the tree. Confirmed beyond a normal grep: ripgrep honours `.gitignore` even
  with `--hidden`, so a gitignored consumer (a local `.env`, a `dist/` bundle, an untracked
  launcher) would have been invisible — a gitignore-blind `os.walk` byte scan found exactly
  two files, the definition and audit2's own prose. No dynamic access either
  (`getattr`/`vars`/`dir`/`__dict__` hits are all vendored site-packages).
- **audit2 was half wrong about it.** It called the default "the last live `hey_nightjar`".
  `git log -S'WAKE_WORD'` over ALL history returns exactly one commit — the squashed
  Phases 1-4 import — and `git log -S'config.WAKE_WORD'` returns none. It was **born dead**
  and never had a consumer in any revision. The stale product name in the default was real;
  "last live" was not.
- **Deleted rather than wired**, deliberately. The wake word is selected twice already, by
  neither a phrase nor this name: which MODEL listens comes from `resolve_model_path()` by
  PATH via `NIGHTJAR_WAKEWORD_MODEL` (a different variable), and which PHRASES are stripped
  comes from `wake_daemon.WAKE_PHRASES`, a deliberate tuple that still carries the legacy
  "hey nightjar" and is asserted by `tests/test_wake_capture.py`. A third, phrase-shaped
  selector would have overlapped both.
- **Verified by running:** `config`, `wakeword` and `wake_daemon` all still import;
  `resolve_model_path()` still resolves; `WAKE_PHRASES` unchanged; `test_wake_capture.py`
  ALL CHECKS PASSED. Note this box resolves to `hey-buddy.onnx` with `is_custom=False` —
  `hey_june.onnx` is not present here, so the live phrase is "hey buddy" (machine-specific;
  differs after a training run).

## NJ-77 — the copyleft guard sweeps ONE site-packages root, but `sys.path` can carry more — FIXED (PR-2) 2026-08-05

- **Found while fixing NJ-76 (rule 7), and it is the same class as the bug it sits beside:
  sweep root != importable graph.** A venv created with `--system-site-packages` carries its
  own site-packages AND the base prefix's on `sys.path`, while `sysconfig`'s `purelib` names
  only the first — so GPL sitting in the base prefix would stay importable and never be
  swept, and the guard would go fully green. Measured: such a venv really does carry two
  roots. `ENABLE_USER_SITE` is likewise True on the base interpreter, making `pip install
  --user` a second unswept-but-importable root in the non-venv case.
- Today `phase2-mcp/venv` is safe — its `pyvenv.cfg` says `include-system-site-packages =
  false` — but nothing asserted it.
- **Fix:** assert we are in a venv (`sys.prefix != sys.base_prefix`), that its `pyvenv.cfg`
  disables system site-packages, and that user-site is off. Checked via `pyvenv.cfg` rather
  than by diffing `site.getsitepackages()`, because on Windows that returns the venv PREFIX
  alongside the real site-packages dir and a naive set-difference flags the venv against
  itself (hit while implementing this, and fixed).

## NJ-76 — licence guards reported ALL CHECKS PASSED having swept ZERO distributions — FIXED (PR-2) 2026-08-05

- **Found by audit2 (N2), reproduced independently both before and after.** `main()` derived
  its sweep root by string-building off `sys.prefix`, so running the guard with the wrong
  interpreter swept an empty `site-packages`, printed **ALL CHECKS PASSED** and exited **0**
  having verified nothing. The five negative controls still passed — they build their own
  synthetic `dist-info` dirs — so the output looked *fully* healthy. Reproduced: `0
  distributions`, exit `0`. The correct invocation lives only in a docstring and **there is
  no CI** (see NJ-56 family / audit2 N3), so the realistic trigger is just typing `python`.
  For a control standing between the project and a GPL/AGPL dependency in a shipped build, a
  false green is the worst failure it can have.
- **Fix, three invariants routed through the existing `check()` (so a wrong-interpreter run
  still reports whether the classifier itself is sound, rather than `sys.exit`-ing early):**
  1. **Identity** — `os.path.samefile(sys.prefix, <repo>/phase2-mcp/venv)`. NOT
     `Path.is_relative_to`: reached over a UNC path (`\\localhost\c$\...`) that returns
     False and `.resolve()` does not normalise UNC to drive form, so a correct sweep would
     fail. `samefile` compares file identity and absorbs junctions, symlinked repos and
     `subst` drives.
  2. **Anchor set, NOT a numeric floor** — a floor like `>= 50` is satisfied by any unrelated
     fat environment (another project's venv, a conda base, a CI image) while proving nothing
     about phase2-mcp, so it cannot backstop the escape hatch. Instead assert specific pinned,
     non-platform-conditional distributions are present. *(Note for the record: a
     requirements-derived floor was rejected, but not for the reason first given — that file
     has zero environment markers and does not list pywin32 at all. The real reason is that
     it is a flat full-pin freeze whose transitive closure is what actually lands, so 100 pins
     vs 121 swept are not commensurable.)*
  3. **Single importable root** — see NJ-77.
- **Sweep root now comes from `sysconfig.get_paths()["purelib"]`**, which is correct on every
  platform by construction — this *retires* the untestable POSIX glob fallback rather than
  preserving it and logging it as an unverifiable branch.
- **The `num2words` LGPL canary is now unconditional.** It was `if "num2words" in report:`,
  so on a wrong-tree run it silently vanished. Written as one `check()` whose `ok` short-
  circuits on membership — that ordering is what stops `report["num2words"]` raising KeyError
  and killing the census with a traceback instead of a `[FAIL]` line.
- **Same defect in the sibling guard, fixed in the same PR:** `test_model_licenses.py`'s
  `find_spec("openwakeword") is None` is a NEGATIVE assertion, trivially satisfied where
  nothing is installed. Reproduced: exit 0 against an empty venv. Now paired with a positive
  control (`onnxruntime`/`httpx`/`mcp` must import).
- **NOT duplicates, recorded so this is not re-litigated:** `test_tts_no_gpl.py` and
  `test_websearch_no_odysseus.py` both die loudly under a wrong interpreter (ModuleNotFound
  on the real runtime graph). audit2's N3 grouping is about CI absence, not vacuity.
- **Verified by running, all three directions:** correct interpreter → 121 distributions,
  exit 0 (unchanged); empty/wrong interpreter → exit 1; escape hatch pointed at an unrelated
  fat tree → still exit 1 on the anchors, which is precisely the case a numeric floor would
  have passed.
- **Residual:** `NIGHTJAR_LICENSE_AND_ATTRIBUTION.md:78` says this guard "fails the build".
  There is no build. Prose left for a docs pass — flagged so it is not mistaken for enforcement.

## NJ-75 — `setup.ps1`'s retired-package purge was documented "never fatal" and was fatal — FIXED (PR-2) 2026-08-05

- **Found while verifying NJ-73 (rule 7). Neither audit caught it, and it DEFEATS the NJ-73
  fix on its own.** The purge of `kokoro-onnx`/`phonemizer-fork`/`espeakng-loader`/
  `openwakeword` carries the comment "Idempotent; never fatal". pip writes `WARNING: Skipping
  <pkg> as it is not installed` to **stderr** for each absent package and still exits 0;
  under `$ErrorActionPreference='Stop'`, PowerShell 5.1 promotes any native-command stderr to
  a terminating error. At least one of the four is absent in any freshly created venv, so it
  threw **every time**.
- **It was masked** only because NJ-73 killed the script at the `New-Venv` above it first.
  Fixing NJ-73 alone would have relocated the fatal error nine lines down — same step
  `[5/7]`, same "no browser-use-mcp venv" outcome, and a `New-Venv`-scoped test would have
  reported PASS. **Observed exactly that** mid-implementation: with New-Venv fixed and this
  not yet fixed, the block created `phase2-mcp/venv` and then died at the purge with
  `browser-use-mcp venv: False`.
- `2>$null` does **not** fix it: the ErrorRecord comes from the redirection itself, not from
  where the output lands. The bash original guards the identical call with `|| true`
  (`scripts/setup.sh:76`); the PowerShell port dropped it. Now wrapped in try/catch, matching
  the pattern already used correctly for `ollama list`.

## NJ-74 — `Get-Py312`'s probes threw under EAP=Stop, making the fallback and the actionable error unreachable — FIXED (PR-2) 2026-08-05

- On a box that HAS the `py` launcher but NOT a 3.12 runtime, `& py -3.12 --version 2>&1`
  raised (same PS 5.1 stderr→ErrorRecord→terminating mechanism as NJ-75), so the `python`
  fallback branch AND the actionable `winget install Python.Python.3.12` message were both
  unreachable — the user just got py's bare "No suitable Python runtime found".
- Both probes are now in try/catch. **`2>$null` was explicitly rejected** as the remedy: it
  still throws (verified), and NJ-75 is the standing proof — that line already used `2>$null`
  and was fatal anyway. A plan adopting it would have shipped a non-fix that reviews clean.
- **Verified by PROXY only (rule 8):** simulated with `py -3.99` on a box that HAS 3.12. It
  exercises the same mechanism, but real confirmation needs a Windows machine with the py
  launcher and no 3.12 runtime.
- Note recorded, not changed: `return @('python')` unrolls to a **scalar** string. Benign —
  `New-Venv`'s `[string[]]` parameter re-coerces it to a 1-element array, and that exact
  scalar shape is now covered by a test.

## NJ-73 — `New-Venv` could NEVER create a venv, on ANY machine: a case-insensitive variable collision, plus a reversed range — FIXED (PR-2) 2026-08-05

- **audit2 (N1) found this but MATERIALLY UNDERSTATED it.** It reported "isolated (1 line)"
  and scoped the impact to "boxes without a working `py -3.12` launcher". Both are wrong.
- **The dominant defect is a case collision, not the range.** PowerShell variable names are
  case-insensitive, so the parameter `[string[]]$Py` and the local
  `$py = Join-Path $Dir 'venv\Scripts\python.exe'` were **the same variable**. The local
  assignment clobbered the launcher before it was ever read (the `[string[]]` constraint
  merely re-coerced the path into a 1-element array), so the creation line invoked the
  not-yet-existing venv interpreter → `CommandNotFoundException`. Verified by executing the
  real function's own bytes (AST-extracted) for three launcher shapes including a perfect
  `py -3.12`: all three failed, no venv created.
- **The reversed range is real but secondary.** `$Py[1..($Py.Length-1)]` is `1..0` for a
  one-element launcher, which PowerShell evaluates as the reversed range `1,0`, duplicating
  the interpreter as its own script argument. *(Correction to an earlier reading: switching
  `@(...)` to a real `@var` splat is NOT required — PowerShell unrolls an array argument into
  separate args for native commands identically, including the empty case. The defect was
  only the range.)*
- **Consequence:** `scripts\setup.ps1` — the documented native-Windows front door — has
  **never** been able to create the phase2-mcp, browser-use-mcp or diffusion-mcp venvs.
  Existing installs were unaffected only because the `Test-Path` guard skips creation when a
  venv already exists, and `-CoreOnly` returns before step `[5/7]` entirely, which is very
  likely why it went unnoticed: the advertised "fastest path" never reaches the broken code.
- **Fix:** rename the PARAMETER to `$Launcher` (touches 2 lines; all three call sites bind
  positionally). Renaming the local instead was rejected as higher-risk — lines 64/65/71/72
  would all have to move together, and missing one makes `pip install` target the SYSTEM
  Python, polluting global site-packages. Tail computed with `Select-Object -Skip 1`.
- **Verified by running the whole `[5/7]` block**, not `New-Venv` alone — the isolated test
  is exactly what would have gone green while the installer stayed broken (see NJ-75). Both
  venvs created, purge silent, second pass a clean no-op. Launcher shapes covered: 2-element,
  the REAL scalar the fallback produces, and 4-element.
- **Still NOT verified (rule 8):** a true end-to-end `setup.ps1` run on a fresh clone. It must
  be done under **`powershell.exe` 5.1 specifically** — PowerShell 7 changed native-stderr
  handling, so a green run under `pwsh` proves nothing for NJ-74/NJ-75.

## NJ-72 — `PlaybackMute` ignores the event `source`, so any local process can deafen the wake daemon indefinitely — OPEN (flagged deliberately, not fixed) 2026-08-04

- **Flagged by audit3 and CONFIRMED by running, end-to-end through a real `sidechannel.py`
  hub. Deliberately NOT fixed** (maintainer instruction: flag only) — recorded so it is not
  lost.
- `PlaybackMute.on_event` (`phase2-mcp/wake_daemon.py:359-367`) keys only off `state`; the
  docstring at `:345-348` says `source` is deliberately NOT filtered. So a
  `{"kind":"tts","state":"playing"}` frame with a **foreign** `source`, or **no `source` key
  at all**, mutes the daemon — wake scoring is skipped at `:663`. Verified live on a scratch
  hub: `spoofed 'playing' (foreign source) muted the daemon: True`.
- **Two corrections to audit3's description, both making it worse:**
  1. **The mute is UNBOUNDED, not "up to 90s".** `PLAYBACK_MUTE_MAX_S = 90.0` exists
     (`:111`), but `:364` resets `_renderer_since` on **every** `playing` frame, so the
     rule-3 backstop never fires — it defends against a LOST `ended`, not a REPEATED
     `playing`. Reproduced: `after 1200s simulated: muted=True, backstops fired=0`.
  2. **The un-mute direction is spoofable too.** With a genuine `source:"orb-ui"` clip
     playing, a foreign `ended` — or a foreign `error`, treated identically at `:365` —
     clears the mute. That *reverts* NJ-57's shipped echo suppression rather than merely
     denying service, which is the more damaging half and is absent from audit3's claim.
- audit3 disagrees with itself on the citation: `audit3.md:1511` points at `:347-348`
  (prose), `:1353` points at `:359-367` (the code). The latter is right.
- **Fix shape when it is taken up:** filter on `source == "orb-ui"` for both directions, and
  make the backstop count from the FIRST `playing` rather than the latest. Note the existing
  suite (`tests/test_wake_mute.py`) has 3 checks that encode the current unfiltered
  behaviour and would need to move with it.

## NJ-71 — `nightjar:voiceStatus` is pushed from exactly one site, so a daemon crash leaves a stale "🎙 Mic is ON" UI — FIXED (PR-3) 2026-08-05

**CONFIRMED ON HARDWARE 2026-08-05, and the fix needed MORE than the push.** During manual
verification the wake daemon crash-looped to `failed` (NJ-79) while the persisted pref stayed
`true`, and the orb rendered a confident **"mic on" with no microphone open**. The app lied
about microphone state — worse than the crash that caused it.

**The push alone would have shipped looking fixed.** `enabled` is derived purely from the
PREF, not from the daemon, so delivering it more often just repeats the same lie on a shorter
interval. `stillListening` didn't rescue it either — that fires only on state `stopped` WITH
the still-listening marker, and a crash-looped daemon is `failed`.

**Fix, both halves:**
- **Push on change:** the supervisor's `onChange` callback now also emits `nightjar:voiceStatus`,
  deduped on the serialized value so a callback that fires for every service transition can't
  spam. The two `voice:set` sites were routed through the same helper — a direct send there
  would leave the dedupe holding a stale value and could then SWALLOW the next real change.
- **Make the status express reality:** added `running` (the wake-daemon process is `healthy` or
  `adopted` — `adopted` counts, it's a live capture process we attached to). The orb, its
  tooltip, its `data-orb-mic` attribute, and the Settings panel now require `enabled && running`
  to claim an open mic; pref-on-but-not-running reads **"voice failed"** and points at the
  health strip.

**Verified headless** (`voice.status.test.ts`, 8 cases incl. the exact hardware state).
**Hardware-pending (rule 8):** that the orb *visibly* stops saying "mic on" — a rendering
claim I won't assert from a unit test.

<details><summary>Original entry (2026-08-04)</summary>

- **Found while verifying NJ-68 (rule 7).** `sendToRenderer("nightjar:voiceStatus", …)`
  occurs **once repo-wide**, inside the `voice:set` handler. The supervisor's own status
  callback pushes only `nightjar:status`. So if the wake daemon dies on its own — crash, mic
  yanked, restart budget exhausted — no voice-status push ever fires, and both the orb and
  the Settings panel keep rendering the last `voice:set` result. `stillListening` only
  recomputes on an explicit get/set.
- This is the inverse of the honesty property PR #151 set out to establish: the UI can claim
  the mic is on after it has stopped, and (with NJ-64) can also claim it is off while it is
  briefly still open.
- **Fix shape:** push `voiceStatusNow()` from the supervisor status callback whenever the
  wake-daemon row changes state.

</details>

## NJ-70 — `restartOnce` hard-kills with no graceful phase — OPEN 2026-08-04

- **Found while verifying NJ-66 (rule 7).** `Supervisor.restartOnce` goes straight to
  `killTree(pid, true)` — `taskkill /F` on Windows — unlike `stopService`, which does
  graceful → verify-gone → hard. So **every** restart, including the legitimate BYOK and
  capability-apply ones, SIGKILLs an engine that may be mid-write.
- Combined with **NJ-67** (those routes restart without diffing, and `setBulk({})` restarts
  on an empty payload), setting a preference to its existing value can drop in-flight agent
  work with no graceful shutdown.
- **Fix shape:** give `restartOnce` the same graceful-then-hard sequence `stopService`
  already implements.

## NJ-69 — `getVoicePref`/`consentedAt` still has no reader in the UI — OPEN 2026-08-04

- **Found while fixing NJ-68 (rule 7 — flagged, not folded in).** `voice.ts`'s `consentedAt`
  is now stamped from a *verified* consent on every enable (it previously recorded only the
  first enable ever and was never refreshed, so it was wrong after any toggle cycle). But
  `getVoicePref()` still has **zero callers repo-wide** — the field is write-only. Its own
  comment justifies it "for honesty in support/debugging", which it cannot serve unread.
- **Fix shape:** surface it in the voice settings panel ("consent given <date>"), or delete
  the field. Not folded into NJ-68's PR to keep that diff to the gate itself.

## NJ-68 — `voice:set` opened the microphone with NO consent check in main; `Boolean()` coercion meant `voice.set("false")` turned it ON — FIXED (PR-1) 2026-08-04

- **Found by the audit3 verification pass; the coercion half was found while fixing it.**
- **(a) The consent gate was renderer-only.** NJ-57 shipped a React consent modal in
  `VoiceSettings.tsx`, but `ipcMain.handle("voice:set")` took a boolean and enabled the mic —
  nothing in main enforced the prompt. Anything holding the preload bridge (DevTools, a
  compromised renderer dependency, future in-tree code) could open the microphone silently.
  Confirmed by running the real `voice.ts` headlessly: `setVoiceEnabled(true)` with zero
  consent evidence wrote `{enabled:true}` and the supervisor's `enabled()` gate immediately
  returned true. NJ-57's own entry asserted the modal as a shipped guarantee — that sentence
  has been corrected in place.
- **(b) `Boolean(enabled)` failed OPEN on a type error.** IPC payloads are structured-clone,
  so `voice.set("false")`, `set(1)`, `set({})`, `set([])`, `set("0")` all coerced to true and
  **enabled the microphone**. Verified by running the coercion table.
- **Fix:** two layers. Enabling now requires a `MicConsent` that only `askForMicConsent()`
  can produce (`src/main/voiceConsent.ts`), so a caller that skips the prompt is a COMPILE
  error rather than a runtime surprise; and that function shows a **native** dialog in main —
  the only shape that survives an arbitrary bridge caller. Consent is verified BEFORE any
  store write (a write-then-rollback design would leave a crash window persisting
  `{enabled:true}` → hot mic at next launch). The ask is single-flighted, fails closed with
  no/destroyed window, and maps Esc + the default button to DENY. `voice:set` now requires
  strict `=== true` to enable; anything else takes the disable path. The React modal was
  removed (it would now double-prompt) and its copy became an always-visible disclosure,
  shared with the dialog via `src/shared/voiceConsentCopy.ts`.
- **A renderer-minted consent token was explicitly rejected**: it is a two-line defeat from
  the same console and proves nothing about a human reading the copy — machinery that looks
  like a gate while enforcing nothing is worse than no gate.
- **Residual (rules 6/8):** verified headless only (`voice.consent.test.ts`, 8 tests). That
  the dialog renders in front of the window, that Esc maps to DENY, and that the OS mic
  indicator behaves, can only be confirmed on a native Windows desktop session — PR-1's
  hardware checklist.

## NJ-67 — `capabilities:setBulk({})` restarts opencode-serve unconditionally from the renderer — OPEN 2026-08-04

- **Found while verifying NJ-66 (rule 7 — filed, not fixed).** `capabilities:set` /
  `setBulk` (`main/index.ts:388-394`, `408-415`) and `byok:set` / `remove` (`367-378`)
  restart `opencode-serve` **without diffing** whether anything actually changed — the
  in-code comment at `:406-407` says so deliberately ("a redundant restart is cheap next to
  a stale backend"). `setBulk({})` passes validation because the guard loop iterates
  `Object.keys({})` = `[]` (verified by running that exact loop), so an empty payload is a
  free engine bounce, callable in a loop from the renderer.
- **Why this matters beyond tidiness:** combined with NJ-70 (restart is a hard SIGKILL with
  no graceful phase), setting a preference to its *current* value can drop in-flight agent
  work.
- **This is why NJ-66 is scoped as consistency hygiene and makes NO security claim** — a PR
  saying "the renderer can no longer restart arbitrary services" would be false while this
  route is open. Fix shape: compare incoming prefs/key state to what is stored and skip the
  restart when nothing changed. That contradicts the deliberate comment above, so it needs
  an explicit decision rather than a drive-by.

## NJ-66 — the restartable-state rule lived only in JSX, so `nightjar:restart` honoured any name in any state — FIXED (PR-1) 2026-08-04

- **Found by the audit3 verification pass. PARTIAL verdict: the state gap is real; the
  claimed name-validation hazard is NOT.**
- **(a) No main-side state gate — CONFIRMED by running.** `ipcMain.handle("nightjar:restart")`
  dispatched straight to `supervisor.restartService`; the `{failed, unhealthy}` restriction
  existed only in `HealthStrip.tsx`'s JSX. A probe restarted a **healthy** service through
  the exact call the handler makes (`pid 3632 → 55488`).
- **(b) Name validation — REFUTED, do not re-file.** `restartService` does
  `managed.find(x => x.def.name === name)` and returns on miss. Tested with `null`,
  `undefined`, `0`, `{}`, `["svc"]`, `"__proto__"`, `"constructor"`, `"toString"`, `""`,
  `"SVC"`, `" svc "`, `"svc\0"`, `"../svc"`: no throw, no state change, status unchanged by
  all of them. Strict `===` against a fixed array has no injection or prototype reach. The
  only real defect was that an unknown name **resolved successfully**, so a typo read as
  success — that now throws.
- **Fix:** the rule moved to `src/shared/restartPolicy.ts`, imported by both sides. The gate
  is at the **IPC boundary only** — never inside `restartService`, because six main-side
  callers (BYOK apply, capability apply, the voice model re-apply) restart healthy/adopted
  services on purpose and a supervisor-level gate would break all of them. It is a POLICY
  check, not a concurrency guard (the single-flight at `supervisor.ts:409-421` owns that).
  `HealthStrip` now renders the refusal instead of swallowing it, so a refused restart is
  distinguishable from a dead button.
- **Note on layout:** the shared module is in `src/shared`, NOT `src/main`. A renderer file
  importing from `src/main` fails `npm run typecheck` with **TS6307** (`tsconfig.web.json` is
  `composite` with `include: ["src/renderer/**/*"]`) — reproduced with the repo's own tsc — and
  a vite alias does not fix it, because it is a tsc project-graph error, not a bundler one.
  Both tsconfigs now include `src/shared/**/*`.
- **Scope honesty:** this closes an inconsistency, NOT an abuse route. See **NJ-67**.
- **audit3 citation errors corrected:** it cites the single-flight guard as
  `supervisor.ts:402-412` (real: **409-421**), and contradicts itself on name validation
  (`audit3.md:791` says silent no-op — correct; `:1562` frames it as a validation gap).

## NJ-65 — a forged `transcription` frame still mounts the full-screen voice overlay — OPEN 2026-08-04

- **Found while fixing NJ-63 (rule 7 — flagged, not fixed; the overlay is out of scope for
  PR-1).** `orbAdapter.handleEvent`'s `transcription` case passes on `ev.final !== false`, so
  a frame with **no `final` field** drives `enterThinking()` → state `connecting` →
  `VortexOverlay` mounts `fixed inset-0 z-40` **with pointer events live** for
  `thinkingTimeoutMs` (30s default), and it is trivially re-armable. Any local process on the
  unauthenticated hub can therefore block the entire UI, without touching the microphone.
- **NJ-63's mic gate does NOT close this** — a regression test pins the current behaviour so
  a future change to it is deliberate. Fix shape: gate the overlay on the same voice-enabled
  signal, or require a plausible `final`/`source` on transcription frames.

## NJ-64 — the orb's one-click kill switch does not close the RENDERER's microphone — OPEN 2026-08-04

- **Found while fixing NJ-63 (rule 7 — flagged, not fixed).** `NightjarOrb.tsx`'s click
  handler calls `voice.set(false)`, which kills the wake-daemon **process**. But if the orb
  is in `listening` at that moment, the renderer's OWN `micStream` — opened by
  `orbAdapter.startMic()` via `getUserMedia` — is untouched: nothing in the orb, the hook, or
  the adapter reacts to the pref going false. It stays open until `listeningTimer` fires
  (**15s** default) or a transcription arrives.
- **Why it matters:** NJ-57's stated design is "disable KILLS the capture process, and the OS
  mic-in-use indicator going dark is the user's proof". For up to 15 seconds after the kill
  switch, that indicator can stay lit — the exact thing NJ-57 says must never happen.
- Reading-level conclusion (React was not driven). Fix shape: have the adapter stop the mic
  when the gate closes, not merely refuse the next open.

## NJ-63 — a forged `wake` frame on the unauthenticated side-channel opened the RENDERER's microphone — FIXED (PR-1) 2026-08-04

- **Found by audit3, CONFIRMED by running.** The hub (`phase2-mcp/sidechannel.py`) has no
  auth, no `Origin` check and no producer/consumer split — `websockets.serve()` is called
  with no `origins=`, so any local process (and, since WebSockets are not same-origin
  restricted, potentially a web page) is a fully privileged peer. The renderer's orb adapter
  is permanently connected (the orb lives in the always-rendered header), and its `wake` case
  drove `enterListening()` → `startMic()` → `getUserMedia({audio:true})` with **nothing
  consulting the user's voice preference**. Repro against the real adapter: a minimal
  `{"kind":"wake"}` frame produced `state=listening, getUserMedia calls=1`.
- **This was a SECOND mic-open path, around PR #151's consent gate** — that gate governs the
  wake-daemon *process* (supervisor `enabled()`), a different process holding a different mic
  handle. It never covered the renderer's own.
- **Fix:** a `micAllowed` live getter on the adapter, consulted both at the `wake` case (so a
  forged frame cannot even change state) and inside `startMic()` (the choke point every path
  to the mic passes through). `NightjarOrb` supplies it from the voice status it already
  subscribes to, via a **ref** — the adapter is memoized on `[wsUrl]`, so a captured boolean
  would freeze. It starts `false`: on a privacy switch, unknown means no.
- **Residual:** the hub itself is still unauthenticated — this fix makes the renderer refuse
  to act on a forged frame, it does not stop the frame arriving. Origin/auth on the hub is a
  separate change. See also **NJ-64**, **NJ-65**.

## NJ-62 — the `readGlb` path guard does not follow junctions/symlinks — OPEN 2026-08-04

- **Found while fixing NJ-61 (rule 7).** The new guard is prefix math on the *resolved* path,
  so a Windows directory junction planted inside `os.tmpdir()` that points elsewhere still
  passes. Verified by running: junction creation **needs no elevation**, and `tmpdir()` is
  user-writable. Low reachability (planting one already requires local code execution — though
  note this app ships an agent with a bash tool), so it is documented in-code above the
  predicate rather than blocking the fix.
- `realpath()` was deliberately NOT used: `os.tmpdir()` is itself a symlink on macOS, so
  resolving one side only would reject every legitimate GLB there. A correct fix realpaths
  **both** the candidate and the roots.

## NJ-61 — `cad:readGlb` read ANY absolute path and returned the bytes to the renderer — FIXED (PR-1) 2026-08-04

- **Found by audit3, CONFIRMED by execution** (not by inference): importing the real
  `readGlb` and pointing it outside every CAD directory returned the target file's contents.
  It was the **only** renderer-reachable `readFile` in the main process with no guard of any
  kind — `nightjar:readAudio` is root+extension guarded, `readGeneratedImage` is
  basename-guarded, the preview server routes through `safeResolve`. An omission, not a
  design stance.
- **Fix:** `isAllowedGlbPath()` in `main/cad.ts` — resolve, require an allowed root (with a
  trailing separator, so a `<tmp>-evil` sibling cannot pass the prefix test), require `.glb`.
  Refusal returns `null` **and warns**: a silent null plus a case-sensitive `startsWith` on a
  case-insensitive filesystem is indistinguishable from a broken viewer.
- **Root list is `os.tmpdir()` ONLY**, deliberately narrower than `readAudio`'s. Every GLB the
  renderer can ask for is minted by `convertStepToGlb` into a fresh mkdtemp under `tmpdir()`.
  `~/.nightjar` was excluded because `nightjar:saveAttachment` lets the **renderer** write
  there with a **renderer-chosen extension**, so allowing it would let a compromised renderer
  plant `<uuid>.glb` and read it back. Follow readAudio's *pattern*, not its *root list*.
- `nightjar:readAttachment` was deliberately NOT touched — it is unguarded by design per its
  own comment. `cad:convert` has a similar shape but its `stepPath` is **model-controlled**
  (regex-scraped from tool stdout), which is a materially different trust source and deserves
  its own pass.
- **Verified by running:** the exploit now returns null; the real hero build still returns
  `ok=true, bytes=482132, parts=7` — byte-identical to the pre-fix baseline. The IPC
  round-trip itself needs a GUI session (rules 6/8) and is on PR-1's hardware checklist.

## NJ-60 — hey-buddy's licence statements conflict, and one augmentation dataset is licence-untagged — HALF-RESOLVED (b: closed by substitution, training PR; a: still open upstream) 2026-08-03

- **Found during PR 5's rule-5 sweep of the hey-buddy move (rule 7 — filed, not folded in).**
- **(a) Apache-2.0 vs CC-BY-4.0, unresolved upstream:** hey-buddy's GitHub README § License
  says *"HeyBuddy source code and pretrained models are released under the Apache License
  2.0"*; the HuggingFace repo that actually serves those artifacts
  (`benjamin-paine/hey-buddy` — hard-coded as `pretrained_model_url` in the vendored
  `embeddings.py`) declares `license: cc-by-4.0` in its card frontmatter. Both permit
  commercial use, so nothing is blocked; Nightjar complies with the stricter reading
  (attribution kept in `NIGHTJAR_LICENSE_AND_ATTRIBUTION.md` + `phase2-mcp/NOTICE`). Only
  the maintainer can reconcile it; recorded in `model_licenses.json` and
  `heybuddy_vendor/VENDOR.md`.
- **(b) `mit-impulse-response-survey-16khz` — RESOLVED BY SUBSTITUTION (training PR,
  2026-08-03), and the finding got WORSE on inspection.** The close-out read went to every
  primary source: the McDermott lab's distribution page (`IR_Survey.html` — page source
  grepped: zero licence/terms language), the `Audio.zip` download itself (fetched: 271 WAVs
  + `.DS_Store`, no README or LICENSE), and the paper's code repo
  (`jtraer/IR_Analysis_Synthesis`: `license: null`). **No grant exists anywhere** — the HF
  repacker's "CC-BY 4.0" frontmatter is an unsupported assertion over what defaults to
  all-rights-reserved. The manifest entry is now scope `rejected`, and the substitute is
  **OpenSLR-26 simulated RIRs (Apache-2.0)**: 60k first-party image-method IRs generated by
  the SLR28/26 authors themselves — no upstream corpus lineage — with the label taken from
  the OpenSLR resource page and provenance READMEs read from *inside* the 1.3 GB SLR28 zip
  via HTTP range requests (no full download). SLR28's `real_rirs` subset (RWCP/REVERB/AIR
  lineage) is explicitly excluded for the same reason MIT's set was. Training recipe
  (`RUNPOD.md`) wires `--augmentation-no-default-impulse-dataset` + the SLR26 path;
  `mirror_datasets.py` plans SLR26 and still refuses the MIT set (both verified by
  running `plan`).
- **(c) Residual, stated:** the 18 constituent corpora of the precalculated negatives are
  permissive *per upstream's own licence table* (spot-checked against their HF cards); a
  full primary-source read of all 18 licence files is outstanding and belongs with the
  mirroring work in the training PR.

## NJ-59 — the default Piper training voice (openWakeWord's recommended generator AND hey-buddy's built-in default) is lessac/Blizzard-2013-derived — its licence FORBIDS commercial speech products — RESOLVED for Nightjar (Kokoro-82M replaces Piper end-to-end; the interim stand-in still carries the taint, flagged) 2026-08-03

- **The chain, each link read at its primary source (rule 5), voice-phase PR 5:**
  - hey-buddy's `piper/pretrained.py` pins `piper-libritts-en-r-medium.safetensors`
    (`num_speakers=904` — i.e. Piper's `en_US-libritts_r-medium`); piper-sample-generator's
    default checkpoint is the same voice.
  - `rhasspy/piper-voices` → `en/en_US/libritts_r/medium/MODEL_CARD`: *"Fine-tuned from
    English lessac medium on train-clean-360."*
  - → `en/en_US/lessac/medium/MODEL_CARD`: trained from scratch on Lessac Blizzard 2013.
  - → the Blizzard 2013 licence (cstr.ed.ac.uk), verbatim: *"Research Purposes" … "excludes
    … developing, adapting, amending or otherwise using the Materials for any commercial
    purpose, including the development, marketing, commercialisation, sale or licencing of
    voice synthesis or **speech recognition products or services**"* — Nightjar's exact use
    case. Note LibriTTS-R itself is CC-BY-4.0: the encumbrance is the lessac **checkpoint**
    the voice was fine-tuned *from*, which a dataset-only licence read would have missed.
  - Consequence: hey-buddy's *"Verified for commercial use"* claim is true of its negatives
    and augmentation data and **false of its positives** — and its own pretrained
    `models/*.onnx` inherit the lineage regardless of their Apache-2.0/CC-BY-4.0 label.
- **Resolution — move off Piper entirely, not work around it:**
  - `wakeword_training/generate_samples.py` rewritten: positives AND adversarials come from
    **Kokoro-82M (Apache-2.0, already Nightjar's TTS)**. All 28 English voices (the old
    generator used 5, all same-gender — and still said "Hey Nightjar"), style-vector
    blending (378 pairs × 3 weights, mirroring hey-buddy's Piper SLERP) + speed variation
    ≈ 4,500 distinct timbre/rate identities. Verified by running: blended styles score the
    same as pure voices through the wake pipeline (mean 0.69 vs 0.59) — blends are speech,
    not noise.
  - Single-speaker/single-demographic corpora are a **hard `SingleSpeakerError`**, the
    generator has no audio-capture code path, and `tests/test_wakeword_samples.py` asserts
    both (it specifically asserts the guard refuses the exact pre-PR-5 5-voice set).
  - The rejections are machine-checked: `model_licenses.json` carries
    `REJECTED-piper-libritts-en-r-medium` and `REJECTED-piper-sample-generator-default`,
    and `tests/test_model_licenses.py` fails if they disappear.
  - **Recorded fallback** if 28 voices prove insufficient for the shipped model: a
    from-scratch LibriTTS voice (CC-BY-4.0, 2,456 speakers) — never anything lessac-derived.
- **Residual (why this stays visible rather than fully closed):** the interim
  `hey-buddy.onnx` stand-in the runtime ships **today** was trained by upstream with the
  tainted positives. It is flagged `commercial_ok:false` in the manifest with this NJ as
  the recorded reason, `is_custom=False` keeps the loud startup warning, and it must be
  retired the moment our Kokoro-trained `hey_june.onnx` lands. Free/AGPL distribution
  meanwhile is fine.

## NJ-58 — openWakeWord's pretrained MODELS (incl. the shipped `hey_jarvis` fallback) are CC-BY-NC-SA — NON-commercial — RESOLVED (voice-phase PR 5: engine moved to hey-buddy; no NC artifact remains in the tree; backbone licence primary-source-verified AND weight-identity-proven) 2026-08-03

- **Verified from the actual installed package (rule 5), voice-phase PR 3:**
  `openwakeword-0.4.0.dist-info/METADATA` (the package's own README) states: code is
  **Apache-2.0**, but *"All of the included pre-trained models are licensed under the
  Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International license due to
  the inclusion of datasets with unknown or restrictive licensing as part of the training
  data."* The earlier voice-plan license read covered the CODE license only — this entry
  corrects the record for the MODELS.
- **Files affected** (`openwakeword/resources/models/` in the venv):
  - `hey_jarvis_v0.1.onnx` — **the fallback Nightjar actually uses today**
    (`wakeword.resolve_model_path()`); CC-BY-NC-SA → **must not ship in any commercial
    build**. Free/AGPL distribution is compatible while non-commercial.
  - `alexa_v0.1.onnx`, `hey_marvin_v0.1.onnx`, `hey_mycroft_v0.1.onnx`, `timer_v0.1.onnx`,
    `weather_v0.1.onnx` — present in the wheel, unused by Nightjar.
  - `embedding_model.onnx` + `melspectrogram.onnx` — the shared feature backbone used by
    EVERY inference **including a future custom `hey_june.onnx`**. The same README
    separately describes the embedding model as re-implemented from Google's
    speech_embedding TFHub module under **Apache-2.0** — but the blanket "all of the
    included pre-trained models" sentence is ambiguous about it. **Must be resolved
    upstream (issue/maintainer statement) before a commercial ship**, since NC on the
    backbone would taint even the custom model's runtime.
  - `silero_vad.onnx` — unused by Nightjar's path (no `vad_threshold` passed).
- **Consequences:** (a) the PR-5 custom synthetic `hey_june.onnx` is a **licensing
  requirement**, not a cosmetic rename; (b) its training inputs must also be
  rule-5-verified (negative-feature datasets, piper-sample-generator voices, the
  backbone question above); (c) the runtime now warns about the NC fallback at startup
  (wake_daemon + wakeword.py), and the training README carries the product requirements
  (synthetic multi-voice only — never single-speaker recordings).
- **UPSTREAM IS NON-RESPONSIVE ON THIS EXACT QUESTION (checked 2026-08-03).** Do not
  plan around getting a clarification:
  - [dscripka/openWakeWord#313](https://github.com/dscripka/openWakeWord/issues/313)
    "Model License Question" (2026-01-23) — asks whether `melspectrogram.onnx` and
    `embedding_model.onnx` are free for commercial use. **0 comments, still open (6+
    months).**
  - [dscripka/openWakeWord#338](https://github.com/dscripka/openWakeWord/issues/338)
    (2026-06-25) — the same question in detail, citing the Apache-2.0 origins (the
    melspectrogram export from torchlibrosa, the embedding model re-implemented from
    Google's speech_embedding TFHub module). **0 comments, still open.**
  - Nightjar deliberately did NOT file a third duplicate. Track/subscribe to those two;
    a maintainer statement in either closes this item. **Because a clarification may
    never come, the commercial plan needs a fallback that does not depend on it** —
    either regenerating the backbone ourselves from the Apache-2.0 Google source, or a
    different engine with permissive WEIGHTS (evaluation pending; the integration
    surface is small — `WakeWordDetector.process_frame(int16[1280]) -> score` plus a
    model path — so a swap is contained).
- **RESOLUTION (voice-phase PR 5, 2026-08-03) — the predicted engine swap happened;
  upstream clarification was never needed:**
  - **The engine is now [hey-buddy](https://github.com/painebenjamin/hey-buddy)**
    (Apache-2.0 code, permissive artifacts; fork `AxeH666/hey-buddy`, vendored at
    `phase2-mcp/wakeword_training/heybuddy_vendor/` @ `6e78d26`, models sha256-pinned
    in `phase2-mcp/model_licenses.json`). The `openwakeword` pin is out of
    requirements.txt, the package is purged from the venv AND by both setup scripts
    (the #146 lesson: pip never removes on requirement removal), and
    `tests/test_model_licenses.py` fails the build if it, or any un-manifested model
    binary, ever returns. **No CC-BY-NC-SA artifact remains in Nightjar's tree.**
  - **The backbone question closed with BOTH a primary source and a run (rule 6):**
    (a) the Kaggle model card for `google/speech-embedding` states **Apache-2.0**
    (maintainer-verified in a browser, 2026-08-03, screenshot archived:
    https://www.kaggle.com/models/google/speech-embedding); (b) loading hey-buddy's
    `speech-embedding.onnx` beside openWakeWord's `embedding_model.onnx` shows **all 37
    shared weight initializers numerically identical** — two tf2onnx conversions
    (1.12.1 vs 1.9.3) of the same Google network, and the mel front-ends are
    **byte-identical** (same sha256). openWakeWord's blanket NC sentence cannot reach
    weights that are bit-for-bit Google's Apache-2.0 release. Caveat from the same
    experiment: the two embedding **graphs** are NOT interchangeable (openWakeWord's
    adds Pad + Relu + BatchNormalization; cosine ~0.977 on identical input), so
    Nightjar ships hey-buddy's copy — an empirical constraint, not a preference.
  - **Runtime proven by re-triggering the real path, not by config-reading (rule 6):**
    the new onnxruntime-only `wakeword.py` (hey-buddy geometry: 1.08 s window / 120 ms
    hop / 76×32 mel windows / 16×96 embedding sequence) scores a Kokoro-synthesized
    "hey buddy" at **0.991** on the vendored stand-in model, "hey June" at 0.23, and
    unrelated speech at 0.001; measured gain-invariant from 3e-5× to 100× input scale.
    `FRAME` changed 1280→1920 (80→120 ms) — wake_daemon, mcp_server and
    test_wake_capture updated and green.
  - **What is deliberately NOT closed here:** the interim stand-in's own lineage
    (→ **NJ-59**, flagged `commercial_ok:false`); hey-buddy's Apache-vs-CC-BY label
    conflict and the untagged IR dataset (→ **NJ-60**); real-mic acoustic verification
    on hardware (→ NJ-57's PR-6 item, rule 8). The two openWakeWord issues (#313/#338)
    no longer gate anything.

## NJ-57 — wake daemon autostarts UNCONDITIONALLY: an un-consented always-on mic on Linux/WSL; and it can re-wake on its own TTS voice — BOTH HALVES FIXED (voice-phase PRs 2 + 4); acoustic + OS-indicator confirmation pending on hardware (PR 6) 2026-08-03

- **Found during the Hey-June voice-phase scoping survey (rule 7 — filed, not drive-by fixed).**
- **Hot mic without consent — FIXED (voice-phase PR 2):** `wake-daemon` was in
  `nightjarServices()` unconditionally, so the supervisor spawned `wake_daemon.py` at every
  app start. On Linux/WSL its `parec` capture opened the microphone with no opt-in, no
  indication, and no off switch — only *accidentally* inert on native Windows because
  `parec` doesn't exist there (a privacy posture by missing binary, not by design). Now:
  a persisted voice pref (`voice.ts`, **OFF by default**) gates the service via a new
  supervisor `enabled()` hook (checked at the single spawn choke point, so a pending
  crash-restart can't respawn after a disable); enabling always passes through a consent
  prompt (every enable — no "don't show again") whose copy states the cloud-egress
  consequence plainly — **CORRECTED 2026-08-04: as originally shipped that prompt was a
  React modal in `VoiceSettings.tsx` and NOTHING in the main process enforced it, so the
  sentence above overstated the guarantee for anything holding the preload bridge. The gate
  now lives in main (NJ-68); this entry described intent, not enforcement**; the header orb
  shows "mic on"/"voice off" and click = one-click
  kill; **disable KILLS the process** (and a stale listener on :8766 from a prior session
  is actively stopped at startup, sole-listener-verified per rule 4) — the OS mic-in-use
  indicator is the user's source of truth, never a soft-mute. Daemon env is now wired at
  spawn (`NIGHTJAR_MODEL` from the chat pref — voice turns follow the user's Local/Cloud
  choice instead of silently running local; `NIGHTJAR_WAKEWORD_MODEL` pass-through for the
  PR-5 model). **Residual (rule 8):** the OS mic-indicator lifecycle (on → off on disable/
  quit) and real capture can only be confirmed on native hardware — PR-6 checklist.
- **Self-wake echo loop — FIXED (voice-phase PR 4):** the daemon's "wake-scoring pauses
  while a reply plays" note only held for the local `NIGHTJAR_PLAY_TTS=1` path. In the real
  app the RENDERER plays the WAV; the daemon resumed scoring right after publishing
  `tts ready` and could wake on June's own speech from the speakers. The orb already
  published `tts playing/ended` (`orbAdapter.ts`) for exactly this, but nothing subscribed
  — the NJ-56 producer-only pattern, inverted. Now: `sidechannel.Subscriber` (new,
  self-reconnecting background consumer) feeds a `PlaybackMute` state machine; wake
  scoring is skipped between `playing` and `ended` (the mic keeps draining, so the stream
  never backs up), `ready` deliberately does NOT mute (synthesis ≠ playback), and `error`
  unmutes. Rule-3 backstop: `NIGHTJAR_PLAYBACK_MUTE_MAX_S` (default 90s, deliberately >
  the orb's 60s speaking watchdog) force-unmutes and logs if an `ended` is ever lost — a
  stuck mute would be as bad as no mute. The local paplay path mutes explicitly around
  playback and gained a matching subprocess timeout. **Verified by running:** pure
  state-machine tests on an injected clock + a LIVE layer driving real `playing`/`ended`
  frames through the real :8765 hub (`tests/test_wake_mute.py`, 16 checks).
  **Residual (rule 8):** the ACOUSTIC proof — that June, played through real speakers at
  normal volume (not headphones), no longer re-wakes herself — needs the PR-6 hardware
  pass. Barge-in (interrupting a reply) remains explicitly out of scope.
- **Rule 8:** both fixes need a real-mic/speaker verification on native Windows; the echo fix
  specifically needs real speakers (not headphones) — recorded in the voice-phase checklist.

## NJ-56 — second post-removal hygiene sweep: setup.ps1 didn't PARSE (fixed); residual dead wiring + a shim defect remain — RESOLVED (fixed items in-tree; open items listed) 2026-08-03

- **Context:** a four-agent sweep (phase2-mcp / phase3-ui / engine-scripts-config /
  cross-cutting orphans) hunting what the NJ-55 sweep (commit 559cf11) missed.
- **FIXED — `scripts/setup.ps1` did not parse (blocker):** 559cf11 deleted the Odysseus
  `Invoke-GitCode` helper but its closing `}` was a diff CONTEXT line and survived —
  PowerShell aborted at line 39 with "Unexpected token '}'", so the entire native-Windows
  installer was dead while the commit message claimed "Both setup scripts parse".
  Removed the orphan brace; re-verified with `[Parser]::ParseFile` → clean. Lesson: "the
  script parses" must be asserted by running the parser, not by reading the diff.
- **FIXED — stale-claim / dead-config cleanup:** dead `ODYSSEUS_MCP_MEMORY_OWNER` read
  (pim_server) + its opencode.json pin (launcher pinned it to the fallback value, so
  behavior is identical); "odysseus" purged from the TTS CURATED vocabulary; guard-test
  false-positive trap (`deep_research` token would fire on Nightjar's own
  `deep_research_backend`); unused `ALLOWED_SIZES` import; dead `pickActiveEntry` export
  (preview.ts); dangling `reconcileImageEndpoint` comment ref (supervisor.ts); stale
  orb-ui/"Odysseus tree"/"9 MCP commands"/"Odysseus submodule" wording across
  setup scripts, WINDOWS_SETUP.md, telegram-scheduler, globalMode.ts, orbAdapter.ts,
  useOrbAdapter.ts, test-orb.ts, vitest.config.ts, research_backend.py,
  websearch_server.py, nl_intent.py (both copies' docstrings; AST guard unaffected).
- **FIXED — license-attribution gap (rule 5):** `NIGHTJAR_LICENSE_AND_ATTRIBUTION.md`
  claimed Step 7 left "no forked code remains" from orb-ui, but
  `phase3-ui/src/renderer/src/lib/audioVolume.ts` still derives its RMS/EMA/normalize
  mic-monitor math from orb-ui (MIT, © Alexander Chen) — `normalizeVolume()` is upstream's
  formula. Added a scoped orb-ui (MIT, derived-math-only) row and narrowed the Step-7 claim.
- **OPEN — `phase1-engine/hw-detect.mjs` shim still hardcodes `python3` (no timeout):**
  audit1.md P2-10's fix note says hw-detect + hwcheck were both made OS-aware, but only
  the live plugin (`nightjar-hwcheck.ts`) was; the retired-entry-point shim still runs
  `execFileSync("python3", ...)` → fails on native Windows. Small fix (`py -3` on win32 +
  a timeout, mirroring the plugin), deliberately not drive-by-fixed in the hygiene pass
  (rule 7).
- **OPEN — `browser_state` side-channel event has a producer and no consumer:**
  `phase2-mcp/mcp_server.py:102` formats + publishes it; nothing in phase3-ui consumes it
  (`orbAdapter.ts` explicitly ignores it). Dead wiring or an unfinished UI feature —
  maintainer call.
- **OPEN — orphaned-but-kept files (flagged, not deleted):**
  `phase1-engine/opencode.json` (stale Phase-1 provider config; the live workspace is
  `engine-workspace/` since PR #140 — RECOMMEND DELETE; deletion was blocked by the
  session's permission mode), `phase-cad/materials.py` (Task-5 feasibility module, never
  wired; its prompt table was inlined into the cad agent prompt),
  `phase1-engine/nightjar-run.mjs` + `verify-watchdog.sh` (freeze-watchdog, dead per
  audit1.md P3-20/21), and 4 undiscoverable manual bun harnesses
  (`phase3-ui/test-attachments|capabilities|openrouter|vision.ts`) with no npm script or
  doc reference.
- **NOTE — vendored llmfit still says "Odysseus container" / "Cookbook":**
  `hwfit_vendor/services/hwfit/hardware.py:741` is a user-visible warning string naming
  the removed upstream; it only fires inside Docker (not a supported Nightjar path) and
  the tree is vendored (convention: don't edit) — left as-is.
- Also verified clean: `.gitmodules`/`.git/config`/`.git/modules` (opencode only), no
  tracked `*.patch`/`.gitkeep`/symlinks, requirements.txt has no Odysseus-only deps,
  IPC/preload channels symmetric, `pim_db.py` migration + `ODYSSEUS_DATA_DIR` correctly
  kept (legacy-install migration source), `.gitignore`/`.vscode` excludes for removed
  dirs deliberately kept as defense for existing checkouts.

## NJ-55 — post-removal hygiene sweep: inline image render was dead; sync guard was dead; browser-use venv gap remains — RESOLVED (2 fixed, 1 open) 2026-08-03

- **Context:** a six-dimension hygiene sweep after the Odysseus removal (branches pruned:
  42 stale locals, all verified against their merged PR heads; local submodule config +
  .git/modules leftovers cleaned; leftover phase2-odysseus/ + research/odysseus/ dirs deleted).
- **FIXED — inline generated-image display was dead (PR-E delivery gap):**
  `SessionsContext.tsx` still matched the old Odysseus `generated-image/<file>` URL shape;
  the new tool returns `{"path": "...img_<stamp>.png"}`, so the regex never matched and
  generated images never rendered inline. Now parses the path field's basename; verified
  against the exact serialized output from the PR-E e2e (old regex: no match; new: file
  extracted). The PR-E e2e validated tool → PNG-on-disk but not the renderer's inline
  display — that last hop needs a live-UI check at the maintainer's real-key confirmation.
- **FIXED — the P3-17 anti-drift guard was silently dead:** telegram-scheduler's
  `test_nl_intent_sync.py` pointed AUTHORITATIVE at the deleted
  `phase2-odysseus/servers/nl_intent.py`, so its skip branch fired unconditionally.
  Repointed to `phase2-mcp/nl_intent.py` (where PR #143 moved it) and RUN: copies are in
  sync. Lesson: a guard whose precondition dies skips forever — silent-skip guards need a
  hard-fail mode or a reachability check of their own.
- **OPEN — browser-use MCP enabled but venv absent on this box:** `opencode.json` enables
  `browser-use` and the assistant grants its tool, but `browser-use-mcp/venv` does not
  exist here (pre-existing, audit1.md P1-5 — setup builds it on managed installs; this
  box never ran that step). Not a repo defect; provision the venv or expect the tool to
  fail at call time.
- Also in this sweep: 5 agent prompts no longer claim odysseus-/row-bot namespaces; the
  diffusion install step in both setup scripts is now OPT-IN (nothing consumes it since
  PR E); `!research/PHASE2B_REPORT.md` gitignore exception added (it was tracked-but-
  ignored); README/WINDOWS_SETUP/JUNE_context/CLAUDE.md purged of Odysseus-as-present
  claims; stale scheduler "odysseus venv" log wording fixed; tracked Phase-2 demo
  scratch (workspace/project/) removed.

## NJ-54 — Odysseus submodule REMOVED; image gen is BYOK cloud; relicensing now unblocked — RESOLVED 2026-08-03

- **What (PR E):** `research/odysseus` (the AGPL submodule, and the last reason the
  combined work HAD to be AGPL) is gone. Image generation is rebuilt as
  `phase2-mcp/imagegen_server.py` — a direct BYOK call to an OpenAI-compatible
  `/images/generations` endpoint (OpenAI or OpenRouter), selected EXPLICITLY via the
  image capability (env: `NIGHTJAR_IMAGE_PROVIDER`); a stored key alone never routes.
  The Electron image-seed/reconcile machinery (~190 lines in `index.ts`), the
  `image-endpoint.ts` resolver, and the diffusion sidecar launch in `services.ts` were
  removed; the image capability now applies like research/vision/browser (engine-env +
  restart).
- **Behaviour:** Offline image mode = a plain "needs an Online provider" message (no
  local diffusion path ships). A local diffusers backend can return later as an
  ADDITIVE provider behind the same MCP tool without re-blocking anything.
- **License status:** Nightjar REMAINS AGPL-3.0-or-later (its own code was released
  under it). Relicensing is now UNBLOCKED but is a separate maintainer decision on a
  frozen dependency graph — deliberately NOT part of this PR.
- **Existing checkouts:** the local `research/odysseus/` directory stays on disk
  (untracked, gitignored) — delete it manually when convenient. `~/.nightjar/odysseus/`
  data is likewise untouched (the PIM migration of NJ-50 reads it if present).
- **Generated images** now land in `~/.nightjar/images/` (was Odysseus's
  `generated_images/`); the chat inline-render IPC was repointed.

## NJ-53 — venv-wide license sweep findings (the copyleft guard's first run) — RESOLVED (guarded) 2026-08-02

- **Context:** `phase2-mcp/tests/test_no_copyleft_venv.py` now sweeps every installed
  distribution, classifying the ACTUAL shipped license text (rule 5 — never metadata).
  Its first run surfaced the following, each triaged individually:
- **Real catch #1 — GPL still physically installed:** `phonemizer-fork` and
  `espeakng-loader` were dropped from requirements in #139 and setup purges them on
  managed installs, but the DEV venv had never run the purge — the GPL espeak binary
  was still on disk. Uninstalled. This alone justifies the guard.
- **Real weak-copyleft in bundled binaries (allowlisted with reasoning, shippable):**
  - `soundfile` (BSD) ships `libsndfile_x64.dll` — LGPL-2.1, full text in
    `_soundfile_data/COPYING`. ctypes-loaded (dynamic), replaceable.
  - `opencv-python-headless` redistributes FFmpeg (LGPL) binaries in `cv2/`, per its
    own LICENSE-3RD-PARTY.txt. Dynamically linked, replaceable.
  - `pywin32` (PSF) bundles `adodbapi` — LGPL-2.1. Nightjar never imports it.
  - `certifi` and `tqdm` are MPL-2.0 (file-level copyleft; unmodified redistribution
    imposes nothing on the app).
- **False positives the classifier now handles by rule, not allowlist:**
  - GPL-family requires the FSF "verbatim copies" preamble, not just the title —
    prose mentions (typing_extensions' PSF history, pywin32's IDLE notes) don't trip it.
  - numpy/scipy embed the full GPL text for the bundled GCC runtime (libgfortran) —
    accompanied by the GCC RUNTIME LIBRARY EXCEPTION, which exists precisely to permit
    unrestricted redistribution.
  - playwright's `driver/LICENSE` is Node.js's aggregate file; its GPL sections are
    `pkg.m4` autoconf macros (build-time, for ICU4C) carrying the Autoconf special
    exception, with ICU4C's own note that the condition is met.
- **Wheels shipping NO license file at all** (the espeakng-loader failure mode, now a
  hard fail unless allowlisted): `tokenizers` (upstream Apache-2.0), `flatbuffers`
  (upstream Apache-2.0), `ctranslate2` (upstream MIT), `primp` (NJ-52). Allowlisted
  with upstream evidence recorded; the wheel-level omission is the packagers' gap.
  ⚠️ Residual: for these three the upstream license is repo-level knowledge, not a
  file read from the wheel — the wheel simply has nothing to read.
- **Scope residual:** the guard covers the phase2-mcp venv (Nightjar's own runtime).
  `phase-cad/.venv` and `browser-use-mcp/venv` are not yet swept; extend when convenient.

## NJ-52 — `primp` ships no license file in its wheel — RESOLVED (audited) 2026-08-02

- **What:** `primp` (the compiled Rust HTTP client `ddgs` uses) ships `License: MIT
  License` in METADATA but **no license file at all** in the wheel — the same class of
  gap that hid espeakng-loader's stripped GPL binary (rule 5's origin incident).
- **Resolution:** primp ships a CycloneDX **SBOM** (`dist-info/sboms/`), which is
  stronger evidence than a single LICENSE file: all **236 statically-linked Rust
  components** declare licenses — MIT / Apache-2.0 / BSD / ISC / Zlib / Unicode-3.0 /
  0BSD — **zero copyleft**, zero undeclared.
- **Guarded:** `test_no_copyleft_venv.py` allowlists primp tolerating exactly
  `no-file`; if a future primp ships something classifiable as copyleft, it fails.

## NJ-51 — image generation is OFFLINE between PR G and PR E — RESOLVED 2026-08-03 (PR E: BYOK cloud image gen via phase2-mcp/imagegen_server.py; see NJ-54)

- **What:** Odysseus removal PR G deleted `phase2-odysseus/` (per maintainer decision:
  bank the cleanup now, image gen is its own follow-up). That directory held the venv
  the `odysseus-image` MCP server ran in and `seed_image_endpoint.py`, the script the
  Electron main shells to wire a BYOK key / the local diffusion server into the image
  endpoint. With the venv gone the server can never spawn, so the MCP block and the
  assistant's `odysseus-image_generate_image: ask` grant were removed too (NJ-49's
  lesson: never leave reachable-but-broken config dangling).
- **User-visible:** asking the assistant to generate an image now gets "no such tool"
  behaviour (the agent has no image tool) instead of a working generation or a
  descriptive error. The Capabilities UI still shows the image capability; selecting it
  cannot take effect. `index.ts`'s image-endpoint reconcile (`runImageSeed`) now always
  resolves false — it is best-effort by design and logs the failure, but it is a no-op.
- **Returns in PR E**, which decides between pointing image gen at a cloud API directly
  (likely, given the cloud-vision direction) or rebuilding the local diffusers path.
  E must also rework or delete: the `runImageSeed`/`applyImageEndpoint` machinery in
  `phase3-ui/src/main/index.ts`, the diffusion sidecar launch in `services.ts`
  (`research/odysseus/scripts/diffusion_server.py` — still referenced, still AGPL), and
  the Capabilities image rows.
- **License status (explicit, so G is not mistaken for the finish line):** the
  `research/odysseus` submodule REMAINS in the tree and REMAINS the reason the combined
  work is AGPL-3.0-or-later. The relicensing payoff lands at E, when the submodule's
  last runtime use goes away — not at G.

## NJ-50 — PIM rebuilt on Nightjar's own schema; legacy Odysseus data migrates once — RESOLVED 2026-08-02

- **What:** Odysseus removal PR D replaced `from core.database import ...` (Odysseus,
  AGPL) with Nightjar's own SQLAlchemy models (`phase2-mcp/pim_db.py`, MIT). Store moved
  from Odysseus's `~/.nightjar/odysseus/app.db` to `~/.nightjar/pim.db`.
- **Schema narrowing:** Odysseus's `ScheduledTask` carries ~30 columns plus foreign keys to
  `sessions`, `crew_members` and itself; Nightjar only ever read/wrote a small subset. The
  new models declare that subset and nothing else, keeping the `(status, next_run)` index
  the poller's hot query needs.
- **Migration:** one-time, on first use, via raw `sqlite3` — no Odysseus import — so it
  still works after the submodule is deleted (PR G). Non-destructive (old file is opened
  read-only), idempotent (only fills EMPTY tables, so re-runs never duplicate and never
  clobber rows written since), and column-intersecting (an older or newer Odysseus schema
  degrades to the common columns instead of raising).
- **⚠️ Could NOT be verified against real data.** `~/.nightjar/odysseus/` exists on the dev
  box but is **empty** — created by the old `_bootstrap`'s `mkdir` on import, never
  populated. So there was nothing to migrate here. `tests/test_pim_migration.py` exercises
  it against a SYNTHESIZED legacy `app.db` built to Odysseus's real (wide) table shapes.
  **Other machines may hold real notes/tasks/events — a first run there is the only true
  test of the migration.** If it misbehaves, the old `app.db` is untouched and can be
  re-migrated after deleting `~/.nightjar/pim.db`.
- **Also caught:** `tzdata==2026.2` was pinned in `phase2-odysseus/requirements.txt` because
  `nl_intent.py` uses `zoneinfo` and Windows ships no system tz database. Moving that module
  to `phase2-mcp` without the pin broke timezone parsing (`ZoneInfoNotFoundError: UTC`) —
  now pinned there too. A dependency that lives only in the *other* venv's requirements is
  easy to drop on a module move; check the source venv's pins, not just the imports.
- **Residual:** the moved code still calls `datetime.utcnow()`, which emits a
  DeprecationWarning on Python 3.12 and is slated for removal. Pre-existing, not touched
  here; worth a sweep when convenient.

## NJ-49 — `odysseus-docs` was GRANTED, not ungranted — reachability audit before deleting the dead tiers — RESOLVED 2026-08-02

- **Context:** Odysseus removal, PR C deleted the `odysseus-email`, `odysseus-rag` and
  `odysseus-docs` MCP blocks. The plan described all three as having no reachable
  callers. Two of the three matched; **`odysseus-docs` did not.**
- **What the audit actually found** (parsed from `engine-workspace/opencode.json`,
  cross-checked against `phase3-ui/src`):
  - `odysseus-email` — `enabled: false`, **zero** permission grants in any agent,
    zero UI references. Genuinely dead. ✅
  - `odysseus-rag` — `enabled: true` but **zero** permission grants; every agent is
    `"*": "deny"`, so no agent could ever call it. Unreachable. ✅
  - `odysseus-docs` — `enabled: true` **and `odysseus-docs_document_search` was
    `"allow"` on the `assistant` agent**, with the assistant's prompt and description
    both advertising "document" tools. So it was reachable by the default chat agent,
    not dead config. ⚠️
- **Why deleting it was still correct:** the index it searches can only ever be empty.
  The *only* way to add documents is Odysseus's own `rag` server (list/add/remove
  indexed directories), which is permission-denied in every agent and has no UI. There
  is no ingest path anywhere in Nightjar — no MCP tool, no UI action. So
  `document_search` was reachable-but-inert: it could be called and would always return
  nothing.
- **Handled:** removed the MCP block, the `assistant` grant, and the "document" mentions
  from the assistant's prompt + description (otherwise the agent would advertise a tool
  it no longer has). Deleted the now-orphaned `docs_query_server.py` wrapper and
  `tests/test_email_send.py`.
- **Lesson (why this is recorded):** "has no UI" is NOT the same as "has no reachable
  caller". Agent permission grants are a second, independent entry point, and the tool
  surface must be audited from `opencode.json` permissions — not from the UI alone.
  Any future tier deletion should run the same parse-the-permissions check first.

## NJ-48 — a wrong plugin path in `opencode.json` silently disables a SAFETY plugin — MITIGATED 2026-08-02

- **Severity:** high if it ever happens — it disables a safety guard with **no signal at all**.
- **Found:** while moving the engine workspace (PR A). OpenCode resolves path-like
  plugin specs relative to the **directory of the config file**
  (`packages/opencode/src/config/plugin.ts` → `path.resolve(path.dirname(configFilepath), spec)`),
  so moving `opencode.json` changes the required `../` depth.
- **The hazard (verified by deliberately breaking one path, rule 6):** with a
  wrong `../` depth on `nightjar-doom-loop.ts`, the engine **still booted**,
  `/agent` still answered with the full agent list, and the *other* plugins still
  loaded — the broken one was skipped with **no error on stdout, stderr, or any
  HTTP surface**. "It boots and chat works" therefore does NOT prove the plugins
  are loaded.
- **Why it matters:** four of the six are the Nightjar safety harness
  (`no-destructive-write`, `generation-cap`, `doom-loop`, `git-gate`). A typo in
  a relative path would silently remove a guard that CLAUDE.md rules 1–4 depend
  on, and every symptom would look like "the safety plugin just didn't fire."
- **Mitigation (this PR):** `phase1-engine/tests/test_plugin_paths.mjs` statically
  asserts every `plugin` entry resolves to an existing file, and that all four
  safety plugins are listed by name. Verified in both directions — passes on the
  real config, exits 1 on a tree with one broken path.
- **Residual:** the guard proves the file *exists*, not that OpenCode successfully
  *executed* it. A plugin that loads but throws at init is still silent. Closing
  that needs an upstream change (OpenCode surfacing plugin load failures) or a
  per-plugin runtime probe; not attempted here.

## NJ-47 — `tests/test_vision.py` crashes on a default Windows console (cp1252) — OPEN 2026-08-02

- **Severity:** low — the *test* is unrunnable on a stock Windows terminal; the
  feature under test is fine.
- **Found:** incidentally, while adding `tests/test_tts_no_gpl.py` (CLAUDE.md
  rule 7 — recorded rather than fixed as a drive-by, since it is unrelated to
  the TTS/GPL work).
- **Symptom:** `phase2-mcp/venv/Scripts/python tests/test_vision.py` →
  `UnicodeEncodeError: 'charmap' codec can't encode character '→'` (the `→`
  in its own progress output). The test **passes** when run with
  `PYTHONIOENCODING=utf-8`, so this is purely a console-encoding bug in the test
  harness, not in `vision.analyze_image`.
- **Confirmed:** re-ran with `PYTHONIOENCODING=utf-8` → `RESULT: PASS ✅ —
  gemma3:4b analyzed the image offline`. File untouched by this PR.
- **Fix (one line, deferred to whoever next touches that file):** the same
  `sys.stdout.reconfigure(encoding="utf-8", errors="replace")` guard now at the
  top of `tests/test_tts_no_gpl.py`. Any future test that prints non-ASCII on
  Windows needs it.

## NJ-46 — spaCy model would auto-download on first speech (offline-posture violation) — FIXED 2026-08-02

- **Severity:** medium — offline-first posture; a silent network fetch on first TTS use.
- **Symptom:** `misaki/en.py` (the new G2P) does, at `G2P.__init__`:
  `if not spacy.util.is_package("en_core_web_sm"): spacy.cli.download(name)`.
  On a machine without the model, the first `speak()` would reach out to GitHub
  and pull 12.8 MB — the **same posture violation already flagged for the gemma3
  auto-pull**, and exactly the kind of thing an offline-first assistant must not do.
- **Fix:** two layers. (1) `nightjar_capabilities/tts_g2p.py::build_g2p()` checks
  `spacy.util.is_package()` itself and **raises with install instructions** rather
  than letting misaki reach for the network. (2) the model is provisioned at
  *install* time — `requirements.txt` pins the MIT wheel by direct URL, so
  `pip install -r requirements.txt` fetches it during setup, where a download is
  expected and visible.
- **Verified:** in a clean venv with the model pre-installed, `socket.socket` and
  `socket.create_connection` were monkeypatched to raise, then `build_g2p()` was
  constructed and used to phonemize — no network access attempted, G2P works.
- **Residual:** setup still downloads the wheel *from the network at install time*.
  A fully air-gapped installer must vendor the 12.8 MB wheel locally. Not done here.

## NJ-45 — `typer` ≥ 0.27 dropped `click`, breaking spaCy's CLI import — FIXED 2026-08-02

- **Severity:** low — install-time breakage, but a hard failure when it hits.
- **Symptom:** `import spacy` → `ModuleNotFoundError: No module named 'click'`.
- **Root cause:** spaCy declares only `typer<1.0.0,>=0.3.0` but
  `spacy/cli/_util.py` does `from click import NoSuchOption` directly. `typer`
  0.27.0's requires list is `shellingham, rich, annotated-doc, colorama` — `click`
  is gone. So a fresh resolve installs spaCy with no `click`, and `import spacy`
  fails at module scope. Independent of this PR's subject matter; found while
  building the clean-room venv.
- **Fix:** pin `click==8.4.2` explicitly in `phase2-mcp/requirements.txt` rather
  than relying on it arriving transitively.
- **Verified:** reproduced the exact `ModuleNotFoundError` in a fresh venv with
  `misaki num2words spacy` only; after adding the pin, `import spacy` and the full
  G2P path succeed.

## NJ-44 — `misaki.espeak` ships on disk and would become live if phonemizer is ever reinstalled — OPEN (guarded) 2026-08-02

- **Severity:** low — currently inert; it is a *re-entry* risk, not a live defect.
- **What:** the misaki wheel installs `misaki/espeak.py`, which does
  `from phonemizer.backend.espeak.wrapper import EspeakWrapper` and
  `import espeakng_loader` at module scope. It is misaki's **own Apache-2.0**
  source, not GPL code, and it is currently unimportable —
  `ModuleNotFoundError: No module named 'phonemizer'`. `misaki.en` never imports
  it, and we pass our own `fallback=`.
- **Why it's recorded:** if anyone later adds `phonemizer` for an unrelated
  reason, that module silently becomes importable and a future contributor could
  wire `EspeakFallback` back in, reintroducing GPL without an obvious signal.
- **Guard:** `phase2-mcp/tests/test_tts_no_gpl.py` asserts `misaki.espeak` is not
  in `sys.modules` after a real synthesis, arms a `ctypes` trap that raises on any
  espeak/phonemizer library load, and asserts the three GPL distributions are
  absent from `requirements.txt`.
- **Verified:** the guard passes in a venv where phonemizer/espeakng-loader are
  **still installed** — i.e. the DLL was available and nothing loaded it. That is
  a stricter result than a clean venv can give.

## NJ-43 — `en_core_web_sm` is MIT, but its training corpus is commercially licensed — OPEN (note only) 2026-08-02

- **Severity:** informational — no action believed necessary.
- **What:** the spaCy pipeline misaki uses for POS tagging is MIT, but its
  `LICENSES_SOURCES` (read per CLAUDE.md rule 5, not trusted from metadata)
  records OntoNotes 5 as "**commercial (licensed by Explosion)**", plus ClearNLP
  (citation only) and WordNet 3.0 (permissive).
- **Assessment:** the artifact Nightjar redistributes is the MIT-licensed model;
  Explosion holds the corpus license and shipped the result under MIT. Recorded
  because "MIT model, commercially-licensed training data" is exactly the kind of
  gap rule 5 exists to surface, and a future relicense review should see it
  rather than rediscover it.

## NJ-42 — `num2words` is LGPL-2.1 — the last copyleft in the TTS runtime graph — OPEN 2026-08-02

- **Severity:** low today, **blocking for a strict relicense**.
- **What:** removing phonemizer/espeak took all **GPL** out of the TTS path, but
  `num2words` — a *mandatory* misaki dependency — is **LGPL-2.1**, confirmed by
  reading its `COPYING` file directly (its PyPI metadata just says "LGPL"; rule 5).
- **Impact:** fine under the current AGPL-3.0-or-later combined work, and weak
  copyleft rather than strong — it is pure Python, so it is trivially replaceable
  by the user, which is what LGPL §5 is about. But the stated goal was **zero
  copyleft in the runtime graph**, and this does not meet that bar literally.
- **Scope if it must go:** `num2words` is used only to expand numbers into words
  ("42" → "forty two"). misaki calls it from `misaki/en.py`. Replacing it means
  either an English-only number-speller of our own (~150 lines, no external dep)
  plus a small patch/shim so misaki uses it, or upstreaming a pluggable
  number-expander into misaki. **Not attempted in this PR** — flagged as a
  separate decision, since it trades a small license nit for carrying a patch.
- **DECISION (maintainer, 2026-08-02): KEEP num2words. CLOSED — do not reopen.**
  Reasoning: LGPL-2.1, pure Python, dynamically imported and trivially replaceable by
  the user, so LGPL §5-conformant even in a proprietary distribution. Replacing it
  means ~150 lines of our own number-speller plus carrying a patch against misaki
  forever, for a theoretical benefit. `test_no_copyleft_venv.py` allowlists it
  tolerating exactly LGPL — if its license ever CHANGES, the guard fails and this
  decision gets re-reviewed.

## NJ-41 — `useProjects` is per-component state, not a shared store — the root cause behind the PR-#125 whack-a-mole — OPEN (refactor deferred to its own PR) 2026-07-20

- **What:** `useProjects(scope)` holds the projects list in `useState`, loaded from localStorage on
  mount. Every call site (`ProjectsHome`, `ProjectView` — plus the lab hosts like `MechanicalLab`;
  `ProjectsScreen` itself only delegates) gets its OWN copy. They agree only because localStorage is
  the shared source of truth — so the instant a write fails, the instances diverge, and a project
  that exists in one hook's memory is invisible to another.
- **Why it matters:** this is the common root of the SIX storage bugs found reviewing PR #125 across
  six BugBot rounds. Finding #1 (health reset on remount) and finding #6 (a failed `create` that still
  navigated into a project `ProjectView` can't see) are direct consequences; the rest are the same
  "one instance's view isn't another's" shape. The per-operation correctness fixes (revert on failed
  create/duplicate, `persistDuplicate` rollback, don't-navigate-on-failure) stayed in #125; the
  cross-instance *storage-health* signalling did not — see next bullet.
- **Why the global "storage health" banner was REMOVED from #125 (maintainer, 2026-07-21):** the
  app-wide "Changes not being saved" banner needed a shared health signal, and the two stopgaps for it
  (first a module-scoped boolean, then a module-scoped set of failing keys) each grew their own
  lifecycle bugs — round 5 was the boolean being cleared by an unrelated success, round 6 was set keys
  that were never cleared on delete/unmount and a `persistDuplicate` cleanup that ignored its own
  delete failure. That signal is a facet of *this* store-consistency problem, so it does not belong in
  a hand-rolled stopgap. #125 now keeps only the **per-part `Saved`/`Not saved` chip**, which is
  accurate by construction (it reports that part's own last write, no cross-part reconciliation), and
  the whole app-wide storage-health model — including a failure signal for project-list ops
  (create/rename/duplicate/delete), which #125 no longer surfaces beyond the visible revert — is
  deferred to this refactor.
- **The fix (its own PR, not #125):** make the projects list a module-level, per-scope store consumed
  via `useSyncExternalStore` (the shape the now-removed `storageHealth.ts` had used) so every consumer
  shares one list and create→open works because the destination view sees the same data. Build the
  storage-health signal ON that shared store, where key lifecycle is natural, rather than as a side
  channel. It touches the lab scopes (`MechanicalLab` etc.) as well as the general space, so it
  deserves its own diff and its own BugBot cycle rather than riding along mid-PR.
- **Must handle in the refactor (the two deferred findings):** (7) a `persistDuplicate` cleanup-delete
  that itself fails leaves content orphaned on disk — needs the transactional all-or-nothing the
  shared store enables; (8) per-key health must be cleared when a project/part is deleted or the last
  editor unmounts, or a stale key pins the banner forever.
- **Also fold in:** `ProjectView` should stop reading `store.get(id)` (memoized against a ref with
  empty deps) — #125 already moved it to `store.projects.find(...)`, but the store refactor is the
  moment to make that the only pattern.

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
- **Fifth/sixth findings (Bugbot, high-effort pass on PR #125) — and the decision to stop patching.**
  (5, Medium) storage health was a single global boolean, so a success on ANY key cleared the
  app-wide banner while a different panel still (correctly) showed "Not saved" — e.g. Files hit quota,
  then a one-character Memory edit or a rename cleared the banner over still-unsaved Files. (6, High)
  a failed `create` still called `onOpen`, navigating into a project that only existed in the store's
  memory; `ProjectView` mounts its own `useProjects` from disk and could not find it, so the user got
  an empty, un-renameable shell — and content edited there still showed "Saved". Fixed: health is now
  a **set of failing keys** (a success clears only its own key; chip and banner derive from the same
  per-key data and cannot contradict), and `create` returns `{ project, persisted }` + reverts the
  in-memory insert on failure so `submitNew` can decline to navigate. Both root-caused to **NJ-41**
  (per-component store divergence); at four-plus rounds of the same class the maintainer chose minimal
  keyed fixes here and a dedicated store-refactor PR for the cause, rather than a fifth ordering patch.
- **Seventh state — the scope decision that ended the cycle (maintainer, 2026-07-21):** the round-6
  findings (stale content keys pinning the banner; `persistDuplicate` cleanup ignoring its own delete
  failure) were both inside the keyed-set stopgap that the round-5 fix had introduced — the fix was
  generating the next finding. Rather than a seventh patch, the maintainer chose to **remove the global
  storage-health banner and its entire hand-rolled signal** from #125, keeping only the per-part chip
  (accurate by construction — it reports that part's own last write, no cross-part reconciliation).
  `create` still returns `{ project, persisted }` and both `create`/`duplicate` still revert on failure
  — those are per-operation correctness, not the cross-instance signal. The app-wide health model and
  both round-6 findings are deferred to **NJ-41**, where the shared store makes them tractable.
  `storageHealth.ts` and its test were deleted; the `reportStorageWrite`/`storageOk` plumbing removed.
  The transferable lesson, recorded: when a fix keeps producing adjacent findings of its own defect
  class, the abstraction is wrong — stop patching and remove or rebuild it rather than chase round N+1.
- **Residual (rule 8):** the *rendered* per-part chip was not confirmed in a real GUI — that needs a
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

## NJ-37 — orb TTS falls back to a `file://` URL that `media-src` refuses → silent silence — FIXED (voice-phase PR 1; audible-playback verify pending per rule 8) 2026-08-03

- **What:** `NightjarOrb.tsx`'s `loadTtsAudio()` prefers the IPC path (`nightjar.readAudio` → bytes →
  `blob:` URL, which is allowed). When that bridge is unavailable it fell back to
  `return path.startsWith("file:") ? path : \`file://${path}\`` — and the CSP's `media-src 'self' blob:`
  refuses the `file:` scheme. The result was **no audio and no error surfaced to the user**.
- **Why it mattered (rule 8):** a textbook silent no-op — the degraded path was written *as* a
  fallback but could not work under the app's own CSP, so TTS just went quiet with no visible signal.
- **Fix (both halves of the entry's own decision):** the dead `file://` branch is DELETED — a missing
  bridge now throws — and every TTS failure path (resolver throw, `<audio>` element error, refused
  `play()`) routes through a new adapter `onTtsError` callback; the orb shows a transient
  `nightjar-alert` "audio failed" label instead of silence. The adapter's own default resolver (which
  had the same `file://` fallback) now rejects loudly. Superseded in-flight clips (B11) deliberately
  do NOT report — supersession is normal turn flow.
- **Verified (rule 6, code half):** the exact failure is re-triggered headlessly in
  `src/renderer/src/lib/orbAdapter.ttsError.test.ts` (vitest) and `test-orb.ts` §2d: missing
  resolver → onTtsError + idle; `<audio>` error → onTtsError + idle + published `ended`; superseded
  load → no report. **Residual (rule 8):** the happy path — the WAV audibly playing on a real audio
  device — and the label's real-UI appearance can only be confirmed on hardware; part of the
  voice-phase PR-6 checklist.

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
