# LAB — Implementation Plan (phased PRs)

> **Status: PLAN. No LAB code is built yet.** This document turns [`Lab.md`](Lab.md)
> (the design/vision reference) into an executable, decision-complete plan: a resolved
> decision ledger (§A), the verified codebase ground-truth the plan rests on (§B), the
> phased PR breakdown (§D), the safety posture and its accepted residuals (§E), and the
> outstanding rule-5 LICENSE-read debts (§F). It is **authoritative** for every "open
> decision" in `Lab.md` §5.8 / §9.8 / §12.5 — all of which are now closed here.
>
> **Sequencing:** the LAB build is un-deferred (the Telegram *code* is merged; its live
> round-trip stays user-gated and runs in parallel whenever secrets are supplied).
> Approach: **plan-first, then build one focused PR at a time** under the project merge
> rules (§C). Decisions finalized 2026-07-16.

---

## A. Decision ledger (all resolved)

Every parked/owed decision, with the choice made and the reasoning. "Debt" = a rule-5
verification I will close against the real repo/LICENSE **before that specific tool ships**
(not now — most are late-phase).

### A.1 Cross-cutting architecture + sequencing (Round 1)

| # | Decision | Choice | Notes |
|---|----------|--------|-------|
| 1 | **Renderer CSP fork** (cross-lab: Chem Ketcher/RDKit-JS + §12 web-ifc/Surfer/vcdrom) | **RELAX** | Add `wasm-unsafe-eval` + `worker-src 'self' blob:` + `img-src 'self' data: blob:`. This is a **whole-renderer security downgrade** (weakens every XSS surface, not just chem) — a rule-1/rule-7 change, logged as an `NJ-*` documented decision. **Mitigations (mandatory):** self-host every asset (no CDN); keep `connect-src` loopback-only; still render *non-interactive* 2D/3D via the server-side sidecars (so the relaxed capability is present but minimally exercised). Lands only when Chem is built (Physics-first has no CSP dependency). |
| 2 | **Ketcher (interactive draw→structure)** | **IN for V1** | The only tool forcing both the CSP relax and a brand-new **viewer→agent reverse-emit channel** (viewer as an *input source* — a dataflow direction that doesn't exist today). The reverse channel is designed into the ViewerManager (M3) and activated at Chem (M6). Debt: verify the bundled `indigo-ketcher.wasm` license (Indigo was GPLv3 before its ~2020 Apache relicense). |
| 3 | **Backend MCP egress enforcement** | **Enforce only for net/ML-capable tools** | Pure-compute MCPs (build123d/RDKit/SciPy — no network code) stay trusted via tool-audit + deny-by-default. A no-net/netns wrapper is added only where a tool could realistically egress (ChemMCP remote services, ML weight fetches, astropy IERS). Debt: verify netns feasibility under WSLg before relying on it. |
| 4 | **First genuinely-new lab** (after shell/Projects/ViewerManager) | **Physics** | All-pip/CPU/offline, **no CSP dependency**, closest to CAD's proven pattern; exercises the ViewerManager's new trajectory/field/FEA viewers. Lowest-risk net-new lab. |

### A.2 Chem specifics (Round 2)

| # | Decision | Choice | Notes |
|---|----------|--------|-------|
| 5 | **MOSAIC** (ambiguous name) | **Drop** | Dead Py2-era molecular data-model; RDKit (BSD-3, already bundled) fully covers the role. |
| 6 | **Atom Simulator** (ambiguous name) | **Assemble from permissive parts** | Element data = **Mendeleev** (MIT). Orbital 3D geometry = **computed in-house** with SciPy/NumPy (hydrogen-like ψ(n,l,m); **use `scipy.special.sph_harm_y`**, *not* the deprecated `sph_harm`, + `genlaguerre` → marching-cubes isosurface → glTF/JSON for the existing three.js viewer). Periodic-table layout follows three.js's `css3d_periodictable`. **Do NOT bundle** the unlicensed orbital-viewer repos (`electron-orbitals`, `atomic-orbital-viewer`) — no license = all-rights-reserved, reference-only. Optional `Periodic-Table-JSON` = **CC-BY-SA → attribution required**. Later (multi-electron accuracy): **PySCF** (Apache-2.0) in a subprocess. Debts: confirm Mendeleev=MIT + PySCF=Apache from their LICENSE files. |
| 7 | **AiZynthFinder / ZINC stock** | **AiZynthExpander now + self-built permissive stock → full planner later** | Single-step **Expander** needs no stock (drops the ZINC redistribution problem entirely). For the full multi-step planner, build our **own** stock from permissive sources: **PubChem** "commercially available" (public-domain ✓) + **ChEMBL** (CC-BY-SA → attribution ✓), combined via `smiles2stock` → `my_stock.hdf5`. Debt: **eMolecules** "free / no-redistribution-clause" is **not trusted** until I read its actual download terms; lean on PubChem+ChEMBL if it doesn't clear. |
| 8 | **ReactionT5 / Rxn-INSIGHT** (ML forward+retro) | **Bundle in** | User wants a capable chem lab. Debt (rule-5, hard gate before bundling): confirm from the actual repo LICENSE + HF model card that **code AND weights AND the training dataset** are all permissive — the *training data* license (USPTO/ORD-open vs a proprietary set) is the real gate, not the code badge. NJ-32 (6 GB GPU / PyTorch) stays a runtime caveat (CPU/onnx or cloud inference). |
| 9 | **`chem_hazard_screen`** | **Deferred** | To the dedicated guardrails session (§E). The benign lab needs no screen; dual-use posture in §E. |

### A.3 Safety sequencing + remaining §12 (Round 3)

| # | Decision | Choice | Notes |
|---|----------|--------|-------|
| 10 | **All content hazard screens** (chem/physics/bio) | **Deferred to a dedicated guardrails session** | Build the labs first; guardrails get their own focused, red-teamed session (which is *more* aligned with "the screen must be an explicit red-teamed gate" than bolting a rushed filter onto a feature PR). **Not deferred:** deny-by-default permission maps, permission-ask on mutating tools, and the hard scope boundaries (no weapon/nuclear-device engineering §5.8; no bioweapon/GoF uplift §8). |
| 11 | **Interim dual-use retrosynthesis** (Expander/Finder, ReactionT5/Rxn-INSIGHT retro) | **Enable unscreened in the interim** | Accepted on the basis that it's an **offline, single-user, no-egress (ML egress-enforced), no-ordering, non-public** tool — materially equivalent to running the upstream OSS directly. **Hard conditions:** residual logged as an `NJ-*` item; **public/multi-user release blocked until the red-teamed screen exists** (§E). |
| 12 | **§12 VCD waveform viewer** | **Surfer native subprocess** | EUPL-1.2 (AGPL-safe); scales on big dumps; CSP-independent. WaveDrom for small inline timing. (The CSP relax makes in-renderer vcdrom *possible* but native still scales better.) |
| 13 | **§12 sectionproperties mesher** | **Pin `>=3.9.0`** | v3.9.0+ replaced the non-commercial Triangle mesher with permissive **`triangle-cpp`**. Debt: verify `triangle-cpp` is MIT/BSD at the pinned version; **fallback** = ship PyNite (MIT) frame-FE alone if it fails the check. Keep PyNite regardless. |

---

## B. Verified codebase ground-truth (checked against source this session)

The plan rests on these facts, confirmed by reading the tree (not `Lab.md`'s "indicative" anchors):

- **Tabs today:** `TabId = "chat" | "cad" | "code"` ([`shell/TabBar.tsx:12`](phase3-ui/src/renderer/src/shell/TabBar.tsx#L12)); `CoworkScreen.tsx` kept but unimported (v2). Screens mounted CSS-hidden (never unmounted) in [`shell/AppShell.tsx:120-134`](phase3-ui/src/renderer/src/shell/AppShell.tsx#L120-L134).
- **Slots:** `SlotId = "chat" | "code" | "cad"`; `DEFAULT_AGENT = {chat:"assistant", code:"coding", cad:"cad"}`; per-slot create-effects + `rebindSlot` + `gcSessions` invariant (a slot must be in `SlotId`/`slots`/`slotsRef` or its session is GC'd) ([`context/SessionsContext.tsx:28-68`](phase3-ui/src/renderer/src/context/SessionsContext.tsx#L28-L68)).
- **`cad` agent:** `"*":"deny"` + 15 `allow` + 5 `ask` (20 reachable of 38) ([`opencode.json:69-96`](phase2-odysseus/workspace/opencode.json#L69-L96)). **Mechanical reuses this verbatim** — no new agent, no new MCP.
- **`cad-build123d` MCP:** phase-cad venv python + `cad_mcp_server.py`, `BUILD123D_IN_PROCESS=1`, 180 s timeout ([`opencode.json:165-171`](phase2-odysseus/workspace/opencode.json#L165-L171)).
- **`CadScreen`** = a 42% `ChatSurface` (bound to `slots.cad`, `agent:"cad"`, research/webSearch/createImage off, + Load-demo) beside a `CadViewer` fed by `cadModel.glb` ([`screens/CadScreen.tsx`](phase3-ui/src/renderer/src/screens/CadScreen.tsx)). Every piece Mechanical-in-shell needs (`slots.cad`, `send(…{agent:"cad"})`, `cadModel`, `cadBusy`, `loadCadHero`, `CadViewer`) already exists.
- **CSP** ([`renderer/index.html:6`](phase3-ui/src/renderer/index.html#L6)): `default-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*; style-src 'self' 'unsafe-inline'; script-src 'self'; media-src 'self' blob:` — **no** `wasm-unsafe-eval`, `worker-src`, or `img-src`. This is what decision #1 relaxes (at Chem, M5).
- **Context stack** (`Connection → Model → Artifact → Sessions → Permission`) stays as-is; every lab reuses it (`Lab.md` §7.1).

---

## C. Standing rules for every PR

**Merge workflow (hard rules):** branch off *fresh* `main` (`git checkout main && git pull`); **one PR at a time, no stacking**; focused/cohesive; **stage only that PR's files**. Wait for BugBot (poll `gh pr view <#> --json statusCheckRollup` until it leaves `IN_PROGRESS`/`QUEUED`); if it flags, verify it's real → fix on the *same* branch → re-push (BugBot reviews once). Clean (CI green + BugBot addressed) → **I merge** (`gh pr merge <#> --merge --delete-branch`) → `git checkout main && git pull`. Commits end with the `Co-Authored-By: Claude Opus 4.8 (1M context)` line; PR bodies end with the `🤖 Generated with [Claude Code]` line.

**CLAUDE.md rules in force:** (1) gate approvable tools via the agent `permission` map, never `tools:{x:true}`; (3) every new subprocess/solver call gets a wall-clock timeout; (4) a failed structured edit surfaces the error, never a full rewrite; (5) read the actual LICENSE before integrating (see §F); (6) prove a safety fix by re-triggering the real failure; (7) flag new hazards as their own named item; (8) verify environment-dependent behavior on the target env and state what you couldn't.

**Verification caveat for this whole plan (rules 6 & 8):** every PR here is UI/Electron. Headless I *can* run: typecheck, `build`, unit tests, and the CAD build→export→GLB→viewer round-trip. What I **cannot** close on this WSL box is the **visual GUI glance** — the launcher/shell actually painting, and three.js/`CadViewer`/Mol\* rendering under SwiftShader (NJ-30/31). Each PR is marked "verified headless; visual render pending a native/display host" — never a false green.

---

## D. Phased PR plan

Milestones are sequential; PRs within a milestone are one-at-a-time. **Milestones 1–3 introduce no new agent, MCP, permission gate, or hazard surface** — pure foundation.

### M1 — LAB shell, proven live with Mechanical (reuses CAD)

- **PR 1 · `feat/lab-tab-launcher-shell`** — add `"lab"` to `TabId`/`TABS` (order Chat/CAD/LAB/Code); new `screens/LabScreen.tsx` (launcher ⇄ shell + back-to-launcher breadcrumb), `shell/LabShell.tsx` (4-region scaffold: left rail · center · right inspector · bottom prompt — clean chrome, no ribbon/banner/debug strip per §4.5), `components/lab/LabLauncher.tsx` (3 discipline cards + building metaphor); `AppShell.tsx` +1 mounted CSS-hidden toggle. **Mechanical is wired live in the same PR** — center = existing `CadViewer`, bottom prompt = `ChatSurface` **reusing `slots.cad`/`agent:"cad"`** + Load-demo. Bio/Chem cards → a visible "coming soon" empty shell (rule-8 fallback, not a dead button). Standalone CAD tab untouched. Left rail = Chats + Settings (Projects added in M2). *No new agent/MCP/slot → zero new permission/hazard surface.*
- **PR 2 · `feat/lab-history-rail`** — generalize `components/code/SessionList.tsx` from code-slot-hardwired to `(slot, agent, idSet)` props; mount as the shell's **Chats** rail; Code keeps using it unchanged (regression gate).
- **PR 3 · `feat/lab-inspector`** — unified right **Inspector** (Properties / Structure / Downloads tabs) generalizing `CadViewer`'s explode/isolate/reset controls + `ArtifactPanel`'s tabs. Mechanical fills Properties (bbox/volume/mass/part-count via `measure`), Structure (parts tree — wires the currently-unused `setPartVisible` hook to inspector checkboxes), Downloads (STEP/GLB/STL). **Shell now fully proven.**

### M2 — Projects system (core v1, §4.6) — biggest net-new subsystem

- **PR 4 · `feat/lab-projects-home`** — per-lab projects store (create/rename/delete/favorite/duplicate, search, sort-by-updated) + Projects-home grid + the now-live **Projects** rail entry.
- **PR 5 · `feat/lab-project-isolation`** — sessions re-keyed `(slot, projectId)`; per-project **Memory / Instructions / Files** (3 new components); Instructions prepended to the lab agent's system prompt; chats/artifacts/downloads scoped per project. *Likely splits into 5a (keying + Instructions) / 5b (Memory) / 5c (Files).* Rule-1 watch: per-project Files must be read through the agent's gated read path, not an ungated backdoor.

### M3 — ViewerManager refactor (unlocks multi-lab)

- **PR 6 · `refactor/viewer-manager`** — extract the two hand-coded handoffs (`ArtifactContext.onToolCall` + the CAD message-watcher) into one `registerViewer({lab, match, extract, convert, component, inspector})` registry; re-express both existing handoffs *as* registrations. **Pure refactor, no behavior change** (CAD + Code render byte-identically = the verification). Lands the interface generalizations later labs need: a **non-WebGL 2D viewer** class, an **artifact collection** (Comparison), and the **viewer→agent reverse-emit channel** (for Ketcher) — designed here, activated when Chem lands.

### M-CADfold — remove the standalone CAD tab *(flexible: any time after M3, once the shell is proven in real use)*

- **PR · `refactor/fold-cad-into-mechanical`** — drop `cad` from `TabId`/`TABS`, remove the standalone `CadScreen` mount, make LAB→Mechanical the sole CAD surface (`Lab.md` §2/§10).

### M4 — Physics lab (first genuinely-new lab)

- **PR · `feat/phase-physics-mcp`** — new `phase-physics/` (own **pip** venv: SciPy/SymPy/Pint/NumPy, PyBullet/MuJoCo/Pymunk, SfePy+gmsh+tetgen, py-pde, rayoptics, hapsira+astropy, thermo/fluids, ikpy, meshio/h5py) + a thin launcher shim + `mcp.physics` + `agent.physics` in `opencode.json` (`"*":"deny"` + read-only analysis `allow` + every solver-run `ask`, rule-1). **Every solver call wrapped in a rule-3 wall-clock timeout.** Egress: pure-compute → trusted (decision #3). Offline vendoring: `astropy-iers-data` + `auto_download=False`, hapsira jplephem kernels.
- **PR · `feat/physics-viewers`** — trajectory player (per-frame `position`/`quaternion`), field/heatmap/vector (`DataTexture`/`ArrowHelper`), FEA stress-morph (`BufferGeometry` vertex-color) — registered via the ViewerManager (§5.6 generalizations).
- **PR · `feat/physics-demos`** — benign demos (projectile, pendulum, orbit, simple FEA). **No `physics_hazard_screen`** (deferred, §E); the hard "simulate-not-engineer-weapons" boundary holds by default.

### M5 — CSP relax + reverse-emit channel *(security-sensitive, standalone, precedes Chem)*

- **PR · `feat/csp-relax-and-reverse-channel`** — the whole-renderer CSP relax (decision #1) as its **own reviewed PR** with the §A.1 mitigations + an `NJ-*` KNOWN_ISSUES entry (rule 7), plus activation of the viewer→agent reverse-emit channel from M3. Verified by re-triggering: WASM instantiates, a `blob:` worker runs, a `data:` image renders (rule 6).

### M6 — Chem lab core (benign capability)

- **PRs** — `phase-chem/` MCP (**pip-only**: RDKit + Chemlib) + `agent.chem` (rule-1 gating; egress-enforced for any net/ML tool, decision #3) + Molecule 2D (server-side RDKit→SVG sidecar *and/or* in-renderer RDKit-JS now the CSP allows it) + Molecule 3D (Mol\*, offline: remote providers disabled, assets self-hosted) + Comparison (artifact collection) + **Ketcher editor** (reverse-emit channel) + **Atom Simulator** (Mendeleev + in-house orbitals) + benign demos (aspirin/caffeine/ibuprofen, Fischer esterification). **Forward RDKit reactions enabled. No `chem_hazard_screen`** (deferred, §E).

### M7 — Chem dual-use sub-phase

- **PRs** — **AiZynthExpander** (single-step, no stock) → **full planner** on the self-built permissive stock (decision #7); **ReactionT5/Rxn-INSIGHT** (after the §F license gate); and the four deferred wrappers — **Elementari** (Svelte→React `mount()`), **Catalyst.jl** (`juliacall`), **Reaktoro** (micromamba env behind the launcher) — each replacing its lighter V1 pip substitute. **Enabled unscreened per decision #11**, with the residual logged `NJ-*` + public-release blocked until the guardrails screen ships. Egress-enforced on the ML/net tools.

### M8 — Bio lab

- **PRs** — `phase-bio/` MCP (Biopython, SynBiopython, DNAplotlib/dna_features_viewer, pySBOL) + `agent.bio` (rule-1) + **Mol\*** (offline/CSP/SwiftShader verification) + Sequence/Plasmid/Circuit viewers + benign demos (insulin/GFP/pUC19). **No `bio_hazard_screen`** (deferred, §E).

### Dedicated Guardrails session *(scheduled separately; MUST precede any public/multi-user release)*

- `chem_`/`physics_`/`bio_hazard_screen` rulesets (deterministic, fail-closed), **red-teamed against real evasions** as an explicit gate (rule 6) — never marked done from the ruleset alone; audit logs; and the public-release / enforced-guardrail decision. Chem baseline scope (CWC Schedules 1/2/3 + controlled-substances + explosophore alerts, with tautomer/salt/protecting-group normalization) is proposed there for sign-off.

### Parked — v3 §12 labs (Electronics · Semiconductors · Architecture)

Sequenced after all of the above. Anchors locked in `Lab.md` §12: Electronics = SKiDL + KiCad DRC/Gerber backbone, export-only, Freerouting opt-in; Semiconductors = FPGA core (Yosys→nextpnr) + OpenLane2 opt-in, **Surfer** native VCD viewer (decision #12); Architecture = IfcOpenShell→GLB + PyNite + **sectionproperties `>=3.9.0`** (decision #13). Excluded (non-commercial): OpenSeesPy; BRL-CAD (weapon-oriented, §5.8).

---

## E. Safety posture & accepted residuals (rule 7)

**Active from day one (not deferred):**
- Deny-by-default `permission` maps on every lab agent (`"*":"deny"` + explicit allow/ask), rule-1 gated — architecture, not a content filter.
- The global permission-approval modal on every mutating tool; rule-3 wall-clock timeouts; the `execute` sandbox (no fs/os/net).
- **Hard scope boundaries that are not toggles:** no weapon / explosive / nuclear-**device** engineering or optimization (`Lab.md` §5.8, "simulate the phenomenon, never engineer the device"); no bioweapon / gain-of-function uplift (§8). These hold regardless of any screen and regardless of "simulation" framing.
- Backend egress enforcement on net/ML-capable tools (decision #3); the loopback-only renderer `connect-src` (kept even under the CSP relax).

**Deferred to the dedicated guardrails session (accepted residual):**
- `chem_`/`physics_`/`bio_hazard_screen` content screens are **not** built in the lab PRs.
- Dual-use **retrosynthesis / ML reaction-prediction** runs **unscreened** in the interim (decision #11).

**Why this residual is acceptable, and its hard bound:** the labs are **offline, local-first, single-user, non-public**, with **no network egress** (enforced for the ML/net tools) and **no real-world actuation or ordering** (§8 invariant-1) — materially equivalent to the user running the upstream open-source tools directly. The bound: the residual is logged as a named `NJ-*` item, and **public or multi-user release is blocked until the red-teamed screen exists.** This is exactly the on-record posture — *build private → red-team → then decide what to release and which guardrails to enforce.*

**New hazard introduced by decision #1 (flagged, not silent):** the CSP relax is a whole-renderer downgrade affecting every XSS surface. Mitigated per §A.1 and shipped as its own reviewed PR (M5) with an `NJ-*` entry.

---

## F. Rule-5 LICENSE-read debts (close before the named tool ships)

| Tool | What to verify | Blocks |
|------|----------------|--------|
| **ReactionT5 / Rxn-INSIGHT** | code **+ weights + training-dataset** all permissive (training data is the real gate) | bundling (M7) |
| **eMolecules** stock | actual download/redistribution terms ("free, no clause" unverified) | full AiZynth planner stock (M7) — PubChem+ChEMBL is the safe fallback |
| **Ketcher / indigo-ketcher.wasm** | bundled Indigo license (was GPLv3 pre-~2020) | Ketcher (M6) |
| **Mendeleev / PySCF** | Mendeleev=MIT, PySCF=Apache-2.0 from LICENSE | Atom Simulator (M6) / PySCF (later) |
| **triangle-cpp** (sectionproperties ≥3.9.0) | permissive (MIT/BSD) at the pinned version | cross-section feature (v3) — fallback PyNite-alone |
| **MuJoCo** | pin a post-2021 Apache-2.0 open release | Physics (M4) |
| §12 set | tscircuit-autorouter, Verilator, Surfer, OpenLane2, Blender/Bonsai, Elmer | their respective v3 PRs |

Also verify at integration: **netns/no-net feasibility under WSLg** (decision #3), and **Mol\*** fully offline under CSP + SwiftShader (M6/M8).
