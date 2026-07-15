# LAB — Design Document

> **Status: DESIGN ONLY. Nothing here is built yet.**
> This document captures the target architecture for turning JUNE's workspaces into
> **LAB** — a top-level hub for engineering disciplines. It documents (a) the LAB hub
> vision, (b) the shared workspace shell every lab reuses (incl. the per-lab **Projects**
> system — Memory / Instructions / Files, §4.6, core v1), (c) the *existing* CAD
> capabilities **+ the *planned* Physics/Simulation/Robotics stack (§5.4–5.8)** that
> together become **Mechanical & Physics**, (d) the *planned* **Bio Lab**, and
> (e) the *planned* **Chem Lab** (§9 — drafted from the user's 14-tool list; the four
> conflicting tools are **kept via wrappers**, deferred to a later phase). When the
> remaining §9.8 decisions are made and this doc is agreed, we turn it into an
> implementation plan broken into focused PRs (one at a time, no stacking — per the
> project's merge rules).
>
> **Sequencing (user, 2026-07-15):** the entire LAB build (Mechanical/Physics, Bio, Chem)
> is scheduled **after the current Telegram work**. The four Chem tools that conflict with
> JUNE's constraints (Elementari, Catalyst.jl, Reaktoro, AiZynthFinder) are **kept** and
> built via wrappers in a **later sub-phase** — V1 leads with lighter pip substitutes (§9.3).
> Physics V1 is entirely pip/permissive/CPU (§5.4). Three further disciplines —
> **Electronics, Semiconductors, Architecture/Civil** — are drafted as a **v3-parked**
> appendix (§12), sequenced after everything above.

---

## 1. Vision — LAB is "an operating system for engineering"

Today JUNE's top nav is a flat set of tools: **Chat, CAD, Code**. Each is a peer tab.

The evolved vision promotes **LAB** to a first-class hub that sits beside Chat and Code.
LAB is not itself a workspace — it is a **launcher**. Clicking LAB is like *walking into a
building and choosing which laboratory to enter*. Inside, every discipline gets its own
dedicated workspace, but they all share one identical UI shell; **only the center viewer
changes** from lab to lab.

The disciplines (from the target tree):

```
LAB
├── Mechanical & Physics 🚪
│     ├── CAD            ← EXISTS TODAY (the current "CAD" tab moves in here)
│     ├── Physics        ← planned (§5.4)
│     ├── Simulation     ← planned (§5.4)
│     └── Robotics       ← planned (§5.3, in-silico only)
├── Bio Lab 🧬
│     ├── Proteins       ← planned
│     ├── Genes          ← planned
│     ├── Pathways       ← planned
│     └── Visualization  ← planned
└── Chem Lab ⚗
      ├── Molecules      ← planned (§9)
      ├── Reactions      ← planned
      ├── Simulation     ← planned
      └── Visualization  ← planned
```

Plus three **v3-parked** future disciplines at the LAB level (§12), sequenced after v1 +
the Physics/Chem/Bio labs: **Electronics/PCB** 🔌, **Semiconductors** ▩, and
**Architecture/Civil** 🏛.

The design principle: **one workspace shell, many viewers.** JUNE already proved this
shape twice — the CAD tab (composer + 3D viewer) and the Code tab (session list + chat +
artifact inspector) are the *same underlying pattern* (watch a session's tool calls →
extract an artifact → convert it via a main-process bridge → render it in a right-hand
inspector). LAB generalizes that pattern into a registry so a new discipline is a
plug-in, not a rewrite.

---

## 2. Navigation model

### 2.1 Top nav (target)

```
JUNE  →   Chat     CAD     LAB     Code
                    ▲        ▲
                    │        └── launcher: Mechanical / Bio / Chem
                    └── stays a separate tab FOR NOW; planned to move into LAB → Mechanical
```

- **Chat** — unchanged (the general assistant).
- **CAD** — stays as its own top-level tab **for now**, so nothing regresses while LAB is
  built. The plan is to **fold CAD into LAB → Mechanical & Physics → CAD** once LAB's
  shell is proven, then remove the standalone CAD tab.
- **LAB** — new hub tab. Clicking it shows the **launcher** (§3), not a workspace.
- **Code** — unchanged.

### 2.2 Flow when you click LAB

```
Click LAB
   │
   ▼
┌─────────────────────────────────────────────┐
│              Choose a laboratory              │
│                                               │
│   [ Mechanical & Physics 🚪 ]                 │
│   [ Bio Lab 🧬 ]                              │
│   [ Chem Lab ⚗ ]                              │
│                                               │
│   "Think of it as entering a building and     │
│    choosing which laboratory to work in."     │
└─────────────────────────────────────────────┘
   │  (pick one)
   ▼
The shared workspace shell (§4), with that lab's viewer in the center.
```

---

## 3. The LAB launcher

When LAB is selected, the center of the app shows a **launcher screen** — a small set of
large entry cards, one per discipline. This is deliberately sparse: a title
("Choose a laboratory"), the three cards with their emoji, and a one-line building
metaphor. No workspace chrome yet — the sidebars/inspector/prompt box appear only *after*
a lab is chosen.

- Selecting a card enters that lab's workspace (§4) with the correct center viewer.
- A persistent way back to the launcher (e.g. a "LAB ▸ Mechanical" breadcrumb, or
  re-clicking the LAB tab) lets the user switch labs.
- The launcher remembers the last-entered lab so returning to LAB can optionally jump
  straight back in (design choice — default to showing the launcher).

---

## 4. The shared workspace shell (identical for every lab)

**This is the heart of the design.** Every lab — Mechanical, Bio, Chem — presents the
**exact same layout**. Only the **center main viewport** differs. Same sidebar, same
prompt box, same project system, same chat history, same inspector panel.

```
┌────────────┬──────────────────────────────────────┬─────────────────┐
│            │                                        │                 │
│  LEFT      │         CENTER  MAIN VIEWPORT          │   RIGHT         │
│  SIDEBAR   │   (the ONLY part that changes per lab) │   INSPECTOR /   │
│            │                                        │   PROPERTIES    │
│ 💬 Chats   │   Mechanical → CAD + physics sims      │                 │
│ 📁 Projects│   Bio        → protein / sequence /    │  Properties     │
│            │                plasmid / circuit view  │  Sequence       │
│  ───────   │   Chem       → molecule / reaction     │  Structure      │
│ ⚙ Settings │                view (2D/3D, editor)    │  Downloads      │
│            │                                        │                 │
├────────────┴──────────────────────────────────────┴─────────────────┤
│  ▎ Prompt box  (natural-language input, bottom, full width)          │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.1 Left sidebar (identical across labs)

- **💬 Chats** — a list of past conversations *scoped to this lab*, like the history rail
  in ChatGPT / Claude. Click one to resume it.
- **📁 Projects** — the user's **projects for this lab** (per-lab, Claude-style). A project
  is an isolated container so work doesn't get mixed up — it owns its own chats, **Memory**,
  **Instructions**, and **Files** (§4.6). Click to open the Projects home / a project.
- **divider**
- **⚙ Settings** — per-lab / app settings entry.

The Chats and Projects lists are **list-style navigation**, not the current CAD composer.
This is a genuine new building block (see §7.3 — today's `SessionList` is code-slot-only
and must be generalized). **Projects are per-lab and are core v1** (§4.6), not a later add-on.

### 4.2 Center main viewport (the ONLY per-lab difference)

This is where each lab plugs in its viewer:

| Lab | Center viewport |
|-----|-----------------|
| Mechanical & Physics | The existing three.js **CAD viewer** (GLB in; orbit/pan/zoom, exploded view, part isolation, reset/frame). Physics adds a **trajectory player**, **field/heatmap/vector** viewers, and an **FEA** stress viewer (§5.6). |
| Bio Lab | A **ViewerManager**-selected viewer: Protein (Mol\*), Sequence, Plasmid map, or Genetic-circuit diagram — chosen per the tool the agent ran. |
| Chem Lab | A **ViewerManager**-selected viewer: Molecule (2D SVG + 3D Mol\*), Editor, Reaction, Simulation, or Comparison — chosen per the tool the agent ran (§9.2). |

### 4.3 Right inspector / properties panel (identical shell, lab-specific content)

A tabbed inspector on the right — same frame everywhere, content driven by the active
viewer:

- **Properties** — key/value facts about the selected object (Mechanical: bbox, volume,
  mass, part count; Bio: residue count, MW, GC%, feature list; Chem: MW, formula, logP,
  TPSA, H-bond donors/acceptors).
- **Sequence** — (Bio-forward) the linear sequence / annotations; for Mechanical this tab
  can hide or repurpose.
- **Structure** — hierarchy / parts tree (Mechanical: assembly tree; Bio: chains/domains).
- **Downloads** — exported artifacts for this session (STEP/GLB/STL, FASTA/GenBank/SVG,
  etc.), with reveal/download — mirrors today's Code **Files** tab idea.

The inspector is the generalized descendant of today's two right-pane inspectors:
`CadViewer`'s control sidebar (explode/isolate/reset) and `ArtifactPanel`'s
Preview/Code/Files tabs.

### 4.4 Bottom prompt box (identical across labs)

A single natural-language input spanning the bottom. Type what you want; the lab's agent
picks the right local tool, runs it, and the center viewer + right inspector update. This
is the generalized `ChatSurface` composer already used by all three current screens —
with each lab's toolset menu focused (e.g. no web-search/research/create-image in a
focused engineering lab, exactly as CAD does today).

### 4.5 What the shell must NOT have (explicit)

Per the vision, the workspace is clean:

- **No top red ribbon.**
- **No giant warning banner.**
- **No debug/status strip.**

Just the workspace: sidebar, center viewer, inspector, prompt. (Safety gating still
happens — but through the existing modal **permission approval** flow and the silent
biosecurity screen, §8 — not through persistent scary chrome.)

### 4.6 Projects — per-lab workspaces with Memory · Instructions · Files (core v1)

Modeled on **Claude Projects**, so related work stays separate ("openforge" and "manohiti"
never bleed together). **Per-lab** — a project belongs to one discipline (a CAD project and a
Bio project are separate lists) — and **core v1**: the projects system ships with the first
version of the labs and every lab reuses it *(decisions: user, 2026-07-15)*.

**Projects home** (reached from the sidebar 📁): a grid of **project cards** (name + optional
one-line description + "Updated …"), with **New project**, **search**, and **sort (Last
updated)**. Creating one opens an empty workspace scoped to it.

**Inside a project** — the normal lab workspace (§4), but every chat, artifact, and download
is scoped to that project. On the **project home** (no chat open yet) the right pane shows a
**project panel** with three parts (mirrors the Claude project view); once a chat is active
the right pane is the lab **Inspector** (§4.3), with Memory/Instructions/Files still reachable
from the project header. The three parts:

- **💾 Memory** — a **per-project** memory that accumulates from *this project's own chats*
  ("project memory will show here after a few chats"), private ("Only you"). Distinct from
  JUNE's app memory and from a lab agent's memory; it is the project's durable context, and
  it is scoped so one project's memory never leaks into another.
- **📋 Instructions** — **per-project** custom instructions, injected into the lab agent's
  system prompt for every chat in this project (e.g. *"Act as my technical co-founder,
  systems architect…"*). Editable inline.
- **📎 Files** — a **per-project** files / knowledge area: reference files the agent can draw
  on within this project. Distinct from *generated* artifacts, which land in the right
  Inspector's **Downloads** (§4.3).

Plus a **favorite (★)** toggle and a **⋯ menu** (rename / delete / duplicate) per project.
Everything a project holds — chats, memory, instructions, files — is **isolated per project
and per lab**; switching project or lab switches the whole context. Build details + the new
components this needs are in §7.3.

---

## 5. Mechanical & Physics (CAD real today; Physics/Simulation/Robotics planned)

This lab is anchored by **the CAD capability JUNE already ships** (§5.1–5.2 — real today);
the **Physics / Simulation / Robotics** stack (§5.3–5.8) is *planned, not built*. The
§5.1–5.2 account below is an accurate description of what exists right now (surveyed against
source), so the migration
into LAB is a *move*, not a *rebuild*.

### 5.1 What CAD does today (all real, all wired)

**Frontend (`phase3-ui/src/renderer/src/`):**

- **3D render** of a converted GLB via three.js — `WebGLRenderer` + `PerspectiveCamera` +
  `OrbitControls` (orbit/pan/zoom with damping), ambient + 2 directional lights
  (`lib/cadScene.ts`).
- **Exploded view** — a single "Explode" slider (`0..2`, step `0.05`); each part is pushed
  radially outward from the assembly center; center-sitting parts (e.g. a sun gear) are
  lifted along alternating ±Z so they still separate (`CadViewer.tsx`, `cadScene.ts`).
- **Part isolation / drill-down** — a "Parts (N)" list; click a part to show only it,
  click again to restore. Isolation is a visibility filter, not a camera move.
- **Reset / frame** — resets explode→0, clears isolation, re-frames the whole model
  (bounding-sphere fit). Auto-frames on every new load.
- **"Load demo" hero** — a button that builds/shows a pre-authored **planetary gearset**
  (sun + 3 planets + ring + carrier = 6 named parts), bypassing the agent entirely — a
  known-good reference with no model generation and no permission prompts.
- **Busy / error states** — "Building model…" overlay; convert/agent errors as a bottom
  banner; GLB-parse errors as a banner inside the viewer.

**Layout today** (`CadScreen.tsx`): a 2-pane row — a left composer (`ChatSurface` bound to
the `cad` session, `agent:"cad"`, with research/web-search/create-image disabled, plus the
"⚙ Load demo" button) and a right `CadViewer`. *Under LAB this becomes the shared shell:
the composer collapses into the bottom prompt + left history rail, and the viewer moves to
the center with its controls folded into the right inspector.*

**What CAD does NOT have today** (absent, not scaffolded — candidates for the Mechanical
roadmap): user-facing measurement/dimension readout, section/cross-section view in the UI,
a BOM/parts-metadata panel, a user "export to file" affordance, camera-preset
(front/top/iso) buttons, and per-part multi-visibility toggles (the
`setPartVisible` controller hook exists but nothing calls it — it's the obvious reusable
hook for inspector checkboxes).

### 5.2 CAD backend (the engine Mechanical inherits)

**MCP server — `cad-build123d`** (launched from `phase-cad/cad_mcp_server.py`, a thin
stdio shim over the upstream `build123d_mcp` package running in the phase-cad venv, with
`BUILD123D_IN_PROCESS=1`). The upstream package registers **38 tools by default**; the
**cad agent reaches only 20** of them because its agent definition uses `"*": "deny"`
plus an explicit allow/ask list (CLAUDE.md rule 1 — gating via the `permission` map, never
`tools:{x:true}`):

- **ALLOW (read-only "see-measure-correct" loop, 15 tools):** `render_view` (agent-only
  verification PNG/SVG — **never** shown in the user viewer), `measure` (volume/area/bbox/
  COM/inertia/mass), `validate` (manifold/watertight gate), `design_audit`,
  `analyze_printability`, `cross_sections`, `inspect_part`, `find_holes`,
  `search_library`, `session_state`, `health_check`, `last_error`, `repair_hints`,
  `workflow_hints`, `version`.
- **ASK (mutating — permission-prompted, 5 tools):** `execute` (run build123d Python in a
  sandbox that blocks fs/os/net under a wall-clock timeout), `export` (emit STEP/STL/DXF/
  SVG — `object_name='*'` produces the hierarchical named assembly that feeds the viewer),
  `import_cad_file`, `load_part`, `install_skill`.
- **DENIED (18 tools, incl. the only destructive `reset`)** — present in the package but
  unreachable, because gating is by exact prefixed name with no wildcard allow. Any tool
  the upstream package adds later is denied-by-default until explicitly listed.

**Trusted STEP→GLB converter — `phase-cad/step_to_glb.py`** (Nightjar-owned, runs
*outside* the MCP sandbox because build123d's `export` has no GLB format and the sandbox
strips file/os access). Electron calls it via the phase-cad venv python under a **60 s
wall-clock SIGKILL timeout** (`main/cad.ts`, CLAUDE.md rule 3). It mitigates two upstream
footguns (NJ-18): re-importing a STEP tree serialises to an empty GLB (fixed by rebuilding
each leaf from its raw OCCT handle, preserving per-part names the exploded view keys off),
and `export_gltf` returns `True` even on an empty file (fixed by parsing the GLB's own JSON
chunk and asserting `meshes>0` + at least one named node). GLB bytes reach the renderer
over IPC because CSP/Electron block a `file://` fetch.

**Two reusable cross-cutting patterns** Mechanical established that every other lab should
copy:

1. **Trusted-converter sidecar** — the model emits only sandbox-safe formats; a
   Nightjar-owned, out-of-sandbox script (under a wall-clock `execFile` timeout)
   post-processes into the viewer format and *self-validates its own output bytes*.
2. **Pre-authored "hero" demo** — a known-good, permission-prompt-free reference build
   wired to a panel button, decoupled from live open-ended generation.

### 5.3 Mechanical & Physics roadmap (planned, not built)

The four sub-disciplines under this lab (they share the CAD workspace shell; only the
center viewer changes):

- **CAD** — as above (§5.1–5.2); first thing to move into LAB.
- **Physics** — the "theory sandbox": natural language → the agent picks a local solver →
  a simulation runs → the three.js viewer animates it. Same CAD interaction model. Detailed
  tool stack in §5.4; starts from `materials.py`'s tier-1 feasibility layer (density/yield,
  numeric sanity) and grows into ODE/FEA/field solvers.
- **Simulation** — motion/assembly sim + FEA/CFD via local solver MCPs (§5.4, §5.7).
- **Robotics** — kinematic chains / URDF / IK / motion planning, **in-silico only** (§8 —
  no real actuator control; the dual-use edge lives at the hardware layer, not the math).

> **This §5.4–5.8 Physics plan is design-only — nothing built.** It was drafted from a
> user-supplied tool survey, then **every tool re-verified against its actual repo**
> (license, pip-vs-conda, WASM/CSP, offline, hardware) — the survey's own claims were
> corrected where wrong (see the corrections callout in §5.4). Sequenced **after the
> Telegram work**, like Bio/Chem.

### 5.4 Physics & Simulation — the tool stack (bucketed against JUNE's constraints)

The interaction model is CAD's: **prompt → agent picks a solver tool → compute → three.js
renders**. Tools are bucketed below. **Licenses were verified against the real LICENSE
files this pass**, but must be re-confirmed at integration (CLAUDE.md rule 5). The decisive
license fact: **not one tool here is GPL-2-*only*** (the only real AGPL-3.0 incompatibility)
— every copyleft solver is an `-or-later`/compatible variant *and* is run as a separate
subprocess (mere aggregation), so all are AGPL-safe. All are **CPU-only** (no CUDA); every
long solve needs the **rule-3 wall-clock timeout**.

**✅ V1 — pip, permissive/compatible, CPU, offline, Python-MCP subprocess (matches the CAD
pattern exactly):**
- **Theory-sandbox backbone** — **SciPy** (`solve_ivp`/`odeint` — the ODE workhorse for
  projectiles, pendulums, orbits, N-body, springs, waves), **SymPy** (`physics.mechanics`
  — symbolic Lagrangian/Kane EoM, "show the math *and* run it"), **NumPy**, **Pint** (units
  — dimensional safety on every tool). All BSD, pure-offline.
- **Rigid-body / robotics engines** — **PyBullet** (Zlib; 3D rigid-body, URDF),
  **MuJoCo** (Apache-2.0 — *pin a post-2021 open release*; articulated bodies, contact,
  biomechanics), **Pymunk** (MIT; 2D). Each streams body-state JSON to three.js.
- **FEA** — **SfePy** (BSD) + its meshers **gmsh** (GPL-2-or-later) + **tetgen**
  (AGPL-3 core / MIT `pyvista` wrapper) — **all pip**, so the whole FEA stack is
  conda-free. Reuses CAD-lab STL/OBJ meshes.
- **Simplified CFD / PDE fields** — **py-pde** (MIT; diffusion/advection/heat/wave, "how
  air flows over this wing" *educational*). **Not** Navier-Stokes — label it simplified.
- **Optics** — **rayoptics** (BSD). **Orbital** — **hapsira** (MIT; see correction — the
  poliastro successor) + **astropy** (BSD; *disable IERS auto-download + vendor
  `astropy-iers-data`*). **Thermo/fluids** — **thermo** + **fluids** (MIT; connect to the
  Chem lab). **IK** — **ikpy** (Apache-2.0). **E&M** — analytic **SciPy Coulomb /
  Biot-Savart** (MIT-clean; covers ~80% of educational E&M without Meep).
- **Sidecar converters** — **meshio** (MIT; VTK/mesh → JSON for SfePy) and **h5py** (BSD;
  HDF5 → arrays for field solvers). *Rule-5 note: meshio is still MIT, but its author
  relicensed sibling packages (pygmsh/quadpy/optimesh) to proprietary — don't badge-trust
  that ecosystem.*

**🧩 In-renderer live-sim engines (Mode 2, §5.5 — optional, CSP-safe pure-JS only):**
- **matter.js** (MIT; 2D — the only *genuinely maintained* pure-JS engine) and **cannon-es**
  (MIT; 3D — *works but stale, last release Aug-2022*). These run a live per-frame sim in
  the renderer (a different mode than MCP-replay). *There is **no** maintained pure-JS **3D**
  engine* — the fast ones are all WASM (blocked, below).

**🕓 Later — conda/binary-wrapped (Reaktoro-style, §9.3 precedent) or heavier:**
- **CalculiX** (GPL-2-or-later; external `.inp→.frd` binary — the **cleanest** subprocess
  aggregation, strongest early-promote of the heavy set), **FEniCSx/DOLFINx** (LGPL-3-or-later,
  conda; heaviest FEA — SfePy covers V1), **Elmer** (GPL-2-or-later, binary; multiphysics).
- **Full CFD** — **SU2** (LGPL-2.1-or-later, source build) / **OpenFOAM** (GPL-3-or-later,
  binary; `foamlib` orchestrator is **GPL-3-only** — corrected from the survey's "MIT").
  py-pde is the V1 substitute.
- **heyoka.py** (MPL-2.0, pip; high-precision Taylor ODE — an add-on over SciPy's baseline).
- **Meep** (GPL-2-or-later, **conda-only — not pip**; full FDTD E&M) — **dual-use, §5.8.**
- **OpenMC** (MIT code, **conda-only**, + vendored ENDF/B nuclear data ~GB) — neutron
  transport / reactor-physics education — **dual-use, §5.8.**

**⛔ Rejected for the renderer (CSP/WASM — same wall as Chem's RDKit-JS/Ketcher, §9.4):**
- **Rapier.js** (Apache-2.0), **Jolt** (MIT), **Ammo.js** (Zlib) — all **WASM**, blocked by
  `script-src 'self'` (no `wasm-unsafe-eval`). **phy** (`lo-th/phy`) — **corrected: it is
  NOT pure-JS**; it's a WASM + Web-Worker wrapper bundling **closed** PhysX/Havok binaries
  (an openness wrinkle for an AGPL app) — under our CSP only its Oimo path runs.
  **Substitute:** PyBullet/MuJoCo give the *same* physics in a Python MCP (subprocess,
  CSP-irrelevant).

**Corrections applied vs the source survey** (flagged per CLAUDE.md rule 5/7): **phy** is
not a maintained pure-JS 3D engine; **poliastro is archived** (Oct-2023) → use **hapsira**;
**`pip install meep`/`pip install openmc` do not work** (conda/source only); **ikpy** is
Apache-2.0 (not GPL); **foamlib** is GPL-3-*only* (not MIT); **astropy** silently downloads
IERS data unless disabled; the license concern is **AGPL-3 compatibility**, not "commercial
contamination."

### 5.5 Two integration modes (one matches CAD; one is new)

- **Mode 1 — MCP compute → three.js replay (primary; identical to CAD).** A Python solver
  MCP steps the simulation and streams per-frame state (`{t, bodies:[{pos,quat}]}`, field
  grids, or FEA nodal arrays) as JSON; the viewer replays it. PyBullet/MuJoCo/Pymunk/SciPy/
  SfePy/py-pde all use this. It reuses the CAD handoff wholesale and fits the ViewerManager
  (§7.4) directly.
- **Mode 2 — in-renderer live engine (new interaction mode).** A pure-JS engine
  (matter.js/cannon-es) runs *live* in the renderer; the agent emits a **scene spec**
  (bodies, forces, constraints) and the viewer simulates it per-frame for real-time
  interactivity. This **inverts** the one-way CAD assumption (like the Chem Ketcher editor,
  §9.2) — the agent *configures a live client-side engine* rather than the viewer just
  rendering MCP output. Flag as a real architectural addition, and note it is limited to
  pure-JS engines under the current CSP (WASM engines are §5.4-rejected).

### 5.6 Physics viewers (three.js reuse + the new capabilities needed)

Reuses the existing three.js/`CadViewer` infrastructure heavily, but adds capabilities the
static-GLB CAD viewer doesn't have (so the ViewerManager, §7.4, generalizes further — as
Chem also forced):
- **Trajectory player** — time-series playback: set `mesh.position`/`quaternion` per frame
  from the streamed body-state (rigid-body, robotics, orbits). *New: CAD is a static load.*
- **Field viewers** — `DataTexture` heatmap on a `PlaneGeometry` (heat/pressure/potential),
  `ArrowHelper` vector fields (E&M, flow), `Line`/`TubeGeometry` for orbits & ray optics.
- **FEA viewer** — `BufferGeometry` vertex morph + vertex-color by stress/displacement.
- **2D overlay** — `OrthographicCamera` for matter.js/Pymunk 2D scenes (shares Chem's
  non-WebGL-2D need).
All feed the shared right **Inspector** (Properties: energy, momentum, period, max-stress;
Structure: bodies/mesh; Downloads: trajectory CSV, VTK, field arrays).

### 5.7 phase-physics MCP

A new Python MCP mirroring `phase-cad` (§7.2): own **pip venv** (the V1 set is entirely
pip — no conda needed), a thin launcher shim, one `mcp.physics` + one `agent.physics` block
in `opencode.json`. The `physics` agent's permission map is `"*":"deny"` + read-only
analysis `"allow"`, every solver-run `"ask"` (CLAUDE.md rule 1), **plus** the
`physics_hazard_screen` (§5.8). Every solver call is wrapped in a **rule-3 wall-clock
timeout** (ODE stiffness, FEA/CFD/Monte-Carlo can spin). Heavy `later` tools (Meep, OpenMC,
DOLFINx) get their own **conda/micromamba** env behind the launcher, exactly like Chem's
Reaktoro (§9.3). Offline gotchas to vendor: `astropy-iers-data` + `auto_download=False`,
hapsira's `jplephem` kernels, and OpenMC's ENDF/B HDF5 data (~GB).

### 5.8 Physics dual-use safety (the weapons/explosives/nuclear scope — resolved)

Physics is dual-use and inherits the §8 model (in-silico only, deterministic screen,
refusal, audit, kept-private). The rule is **"simulate the phenomenon, never engineer the
device."** Three buckets:

1. **Ungated — textbook physics.** Projectile/ballistic trajectories with drag, pendulums,
   orbits, E&M/gravitational fields, wave/heat/diffusion PDEs, and reactor-physics
   *education* (criticality concept, neutron-population / point-kinetics). Most V1 tools.
2. **Gated + screened + audited + kept-private** (dual-use, kept-but-gated per the amended
   invariant-6, not declined): rigid-body/impact engines (PyBullet/MuJoCo/…), high-precision
   orbital propagation (hapsira/heyoka — reentry/delivery trajectories), **thermo**
   (energetic-material thermodynamics), **OpenMC** (neutron transport/criticality), **Meep**
   (RF/EM). Blast/shock-overpressure and neutron-transport runs get the **strongest** gate.
3. **Declined outright — regardless of the "simulation" label:** weapon-assembly geometry,
   shaped-charge liner/standoff design, detonation/initiation *timing*, implosion-lens or
   nuclear-device geometry, and any yield/criticality-*optimization toward a functional
   device*. The "simulation" framing does not launder these — if the objective is a working
   weapon, it's declined even on a bucket-2 tool.

**The refusal line:** *"I can simulate the **phenomenon** — the physics, fields, transport,
dynamics — for understanding, but I can't help **engineer or optimize a functional device**.
'Model how a shock wave / neutron population / trajectory behaves' ✅. 'Design, time, or
optimize the geometry/initiation/yield of a weapon, explosive, or nuclear device' ❌."*

**`physics_hazard_screen`** (deterministic, pre-execution, fail-closed): an intent classifier
flags device-engineering signals (assembly/geometry optimization, initiation/detonation
timing, standoff/liner/tamper/reflector params, critical-mass/yield targeting, coupling a
transport/blast run to a geometry-optimization loop) → **clean** = run; **dual-use-legit** =
gate (permission-ask) → run → audit → private; **device-design signal** = refuse (line
above) + audit. Verify by re-triggering a real device-design prompt end-to-end (rules 6/8),
not from config.

> ⛔ **Settled — a hard boundary, not an open decision.** The user asked (2026-07-15) to put
> weapon/explosive/nuclear-**device** design and optimization *in* scope. **That is declined
> and stays declined.** Designing or optimizing a functional weapon, explosive, or nuclear
> device is uplift for mass-casualty harm and is out of scope **regardless of the
> "simulation" framing** or the private/offline/not-public posture — it is **not** a Nightjar
> policy toggle or a §8 invariant that can be amended (it is the "sole purpose is harm"
> carve-out that stays declined even under the amended invariant-6). §5.8 remains "simulate
> the phenomenon, not engineer the device"; buckets 1–2 (studying the phenomenon) stay fully
> supported. (The pasted research was itself self-contradictory — header "in-scope" vs body
> "simulation-only"; §5.8 encodes the body.)

---

## 6. Bio Lab (planned — "CAD for biology")

Bio Lab is the same idea as CAD, aimed at molecular/synthetic biology: **natural language
→ the agent picks a local tool → a viewer opens → interactive visualization → an inspector
with properties.** It is entirely **in-silico** (see §8).

### 6.1 Discipline tree

- **Proteins** — fetch/parse/visualize protein structures; basic property analysis.
- **Genes** — sequences, ORFs, annotations, simple edits/analysis (FASTA/GenBank).
- **Pathways** — metabolic / regulatory pathway views.
- **Visualization** — the shared rendering surface the above feed into.

### 6.2 Viewers (pluggable via the ViewerManager, §7.4)

| Viewer | Renders | Library (approved) |
|--------|---------|--------------------|
| **Protein** | 3D macromolecular structure (PDB/mmCIF) | **Mol\*** (new bundled WebGL dep — must be fully offline per CSP, §7.5) |
| **Sequence** | Linear DNA/protein sequence + annotations | Biopython-driven data → lightweight renderer |
| **Plasmid** | Circular plasmid / feature map | **Biopython + dna_features_viewer** (approved substitution for the Java plasmid tooling) |
| **Circuit** | Genetic-circuit / SBOL diagram | **pySBOL / DNAplotlib** (approved substitution for Java SBOLDesigner) |

These register with a `ViewerManager` so the center viewport swaps based on the artifact
the agent produced (a `.pdb`/`.cif` → Protein; a `.gb`/`.fasta` → Sequence/Plasmid; an
SBOL doc → Circuit) — exactly as CAD swaps on a `.step` export.

### 6.3 Bio MCP — `phase-bio` (mirrors `phase-cad`)

A new Python MCP server following the established template (§7.2): its **own venv**, a
**thin launcher shim** in `phase-bio/`, one `mcp{}` block and one `agent{}` block in
`opencode.json`. Tooling (all local, offline):

- **Biopython** — sequence/structure parsing, analysis, format IO.
- **SynBiopython** — synthetic-biology part/assembly operations.
- **DNAplotlib / dna_features_viewer** — plasmid & circuit rendering data.
- **Mol\*** — protein structure viewer (frontend WebGL dep).
- A **trusted converter sidecar** where a viewer needs a normalized format (mirrors
  `step_to_glb.py`), always under a wall-clock timeout and self-validating its output.

The `bio` agent's `permission` map gates every mutating/generative tool as `"ask"` and
denies-by-default (`"*": "deny"`), listing read-only analysis/visualization tools as
`"allow"`. **Plus** the biosecurity screen in §8, which the CAD template does not have.

### 6.4 Bundled demos (benign only)

Ship a small, clearly-benign demo set so Bio Lab is usable offline out of the box and for
red-teaming: **insulin**, **GFP**, **pUC19** (and similar textbook constructs). A "Load
demo" affordance mirrors CAD's hero button.

---

## 7. How LAB maps onto JUNE's existing architecture

LAB is **not a rewrite** — it's a generalization of patterns already in the codebase. This
section is the concrete engineering map. (Line anchors are indicative, from the current
tree; treat them as starting points, not contracts.)

### 7.1 The workspace pattern that already repeats

v1 ships three tabs — **Chat / CAD / Code** — on one repeatable **slot + screen + agent**
pattern. Adding a discipline is a mechanical mirror of the CAD tab (the newest, cleanest
example). The 5-context provider stack the shell relies on
(`Connection → Model → Artifact → Sessions → Permission`, nested in `App.tsx`) stays as-is:

- **ConnectionContext** — owns the single OpenCode client + the one instance-wide SSE
  subscription (`GET /event`) with a listener fan-out; connect/retry loop; sidecar status.
- **ModelContext** — BYOK model choices + the **global** active model (app-wide, *not*
  per-lab) + cloud-fallback offers.
- **ArtifactContext** — live-preview/inspector state; sits above Sessions so the session
  reducer can push tool-calls into it.
- **SessionsContext** — the multi-session registry: `slots: Record<SlotId, string>` maps
  each tab to its own OpenCode session; the one SSE stream is demuxed by `sessionID`.
- **PermissionContext** — the safety approval flow: a **queue** (chat + code + cad — and
  each new lab — can each have an outstanding "ask"), rendered as one global mandatory
  modal.

### 7.2 "Add-a-lab" checklist (mechanical mirror of the CAD tab)

A new lab `foo` (agent `foo`, MCP `foo-mcp`, optional right-pane viewer) touches ~6
renderer files + 1 config:

1. **`shell/TabBar.tsx`** — add `"foo"` to the `TabId` union **and** a `{id,label}` to
   `TABS`.
2. **`context/SessionsContext.tsx`** — add `"foo"` to `SlotId`; seed `slots` / `slotsRef`
   initial (`foo:""`); `DEFAULT_AGENT.foo`; `DEFAULT_TITLE.foo`; and a per-slot
   **create-effect** (copy the cad effect — create the session on `primaryId`,
   `rebindSlot("foo", id, true)`, recreate + rebind on every reconnect).
   *Invariant:* the slot **must** be registered in `SlotId`/`slots`/`slotsRef` or
   `gcSessions()` will treat its session as unbound and garbage-collect it. The
   `Record<SlotId,string>` typing forces you to touch every initializer (compile error if
   you miss one). Agent-name resolution is defensive (`validAgent()` falls back to
   `assistant` if the agent isn't live, and heals on reconnect).
3. **`screens/FooScreen.tsx`** — new screen; bind `slots.foo`; render `ChatSurface` with
   `onSend=(text,{attachments})=>send(id,text,{agent:"foo",attachments})` and a focused
   `menu`. Use `CadScreen.tsx` (composer + viewer) or `CodeScreen.tsx`
   (list + chat + inspector) as the template.
4. **`shell/AppShell.tsx`** — import the screen; add a **mounted** toggle
   `<div className={tab==="foo"?"h-full":"hidden"}>` (screens are CSS-hidden, never
   unmounted, so drafts + viewer state survive tab switches — a lab screen must tolerate
   being mounted-but-hidden).
5. **(if it has a viewer)** `SessionsContext.tsx` — add `fooModel`/`fooBusy` state, a
   **message-watcher effect** (§7.4), and export them on the value object. Add the preload
   bridge (`preload/index.ts`) and an `ipcMain.handle` in `main/index.ts` that runs a
   **wall-clock-bounded** converter (CLAUDE.md rule 3).
6. **`phase2-odysseus/workspace/opencode.json`** — add `agent.foo` (`mode:"primary"`,
   identity `prompt`, and a **`permission` map** gating every write/exec tool as `"ask"`
   under `"*":"deny"`) and `mcp.foo-mcp` (`type:"local"`, `command` = the phase's venv
   python + a thin launcher shim, both off `{env:NIGHTJAR_ROOT}`; `environment`;
   `enabled`; `timeout` in ms).

Under the **LAB hub**, steps 1 and 4 change slightly: instead of a flat top-level tab per
lab, LAB is one tab that renders the **launcher**, and each lab is a sub-route the
launcher enters. But the slot/agent/MCP/viewer wiring (steps 2, 3, 5, 6) is unchanged —
each lab still owns its own session slot, agent, and MCP.

### 7.3 New shared building blocks LAB needs (don't exist yet)

- **The launcher screen** (§3) — new.
- **A lab-agnostic history rail** — today's `components/code/SessionList.tsx` is a
  resumable session-history sidebar but is **hard-wired to the code slot / `"coding"`
  agent**. LAB's left sidebar (**💬 Chats** + **📁 Projects**) needs it generalized to
  `(slot, agent, idSet)` props.
- **The per-lab Projects system (§4.6) — core v1, all genuinely new** (no equivalent exists
  today): a **projects store** (create/rename/delete/favorite, scoped per lab), the
  **Projects home** grid (search + sort), and per-project **isolation** of
  chats/artifacts/downloads keyed by `(slot, projectId)`. Three new per-project components:
  **Memory** (a durable per-project context store, separate from app/agent memory),
  **Instructions** (a per-project string prepended to the lab agent's system prompt), and
  **Files** (a per-project uploaded-knowledge area the agent can read — distinct from
  generated Downloads). The chat session slot (§7.1) becomes keyed by `(slot, projectId)` so
  each project gets its own session set + its own memory/instructions/files.
- **The unified right Inspector** — generalize `CadViewer`'s control sidebar
  (explode/isolate/reset) and `ArtifactPanel`'s Preview/Code/Files tabs into one tabbed
  **Properties / Sequence / Structure / Downloads** panel whose content is supplied by the
  active viewer.

### 7.4 The ViewerManager abstraction (the key generalization)

Today the "tool output → viewer" handoff exists in **two hand-coded forms**, and they are
the *same shape*:

1. **Code/Artifact form** — `ArtifactContext.onToolCall(call, sid)`: a `write`/`edit`
   tool → mirror content into the per-session sandbox over the preload bridge → open the
   panel.
2. **CAD form** — a two-stage handoff: arm `refs.cadExport` on send / observe
   `sawBuild`/`sawExport` on idle (auto-send one export directive if it built but never
   exported, bounded so it can't loop); then a **message-watcher effect** scans the
   session's messages for a completed `build123d_export`, regex-extracts the `.step` path,
   calls the STEP→GLB bridge, and sets `cadModel`. Dedup via `processedExportsRef`
   (survives reconnect), in-flight guard, and a monotonic `cadGenRef` "latest-wins" token.

Both are: **watch a session's tool calls → extract an artifact (path or content) →
convert via a main-process bridge → render in a right-pane inspector.**

**`ViewerManager` parameterizes this** so a lab *registers a viewer* instead of
hand-coding a watcher. A registration is roughly:

```ts
registerViewer({
  lab: "bio",
  match: (toolCall) => /* e.g. completed export whose path ends .pdb|.cif|.gb|.fasta */,
  extract: (toolCall) => /* the artifact path/bytes */,
  convert: (artifact) => /* optional main-process, wall-clock-bounded sidecar → viewer fmt */,
  component: ProteinViewer,          // the center viewport component
  inspector: ProteinInspector,       // supplies Properties/Sequence/Structure/Downloads
})
```

Mechanical registers the CAD viewer (`.step` → GLB → `CadViewer`); Bio registers Protein/
Sequence/Plasmid/Circuit; Chem registers its own. The two existing handoffs are refactored
to *be* registrations, so there's one code path, not N.

### 7.5 Constraints every lab inherits (must respect)

- **CSP / offline** — `renderer/index.html`: `default-src 'self'; connect-src 'self'
  http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*`. Network is
  **loopback-only**; `script-src 'self'` = **no CDN, no inline scripts** — every dep is
  bundled (three.js already is; **Mol\*** must be too). There is **no explicit
  `img-src`/`data:`** (falls back to `default-src 'self'`), so any viewer relying on
  `data:`/remote assets must be re-checked against the policy before use. **Two caveats
  the Chem audit surfaced (§9.4/§9.6):** (1) this policy also has **no `wasm-unsafe-eval`
  and no `worker-src`**, so any WASM viewer (RDKit-JS, Ketcher's Indigo) and any `blob:`
  web worker (Mol\*/Miew) is *blocked* until the CSP is relaxed — a deliberate,
  whole-renderer security decision; (2) the CSP governs only the **renderer** — it does
  **not** sandbox the network of the backend MCP subprocesses, so "no egress" for
  Python-side tools is *trusted, not structurally enforced* today.
- **WSL software-WebGL (NJ-31)** — under WSL, `app.disableHardwareAcceleration()` +
  `--enable-unsafe-swiftshader` at module load (WSLg's GPU process crashes and can take the
  window down; SwiftShader renders three.js/Mol\* in software — stable but slower). Any
  GPU/WebGL-heavy lab (Mechanical, Bio Protein view) inherits this, and the *visual* render
  is still a **rule-6 GUI-glance verification gap** on this WSL box — only closable on a
  display-capable host.
- **permission-not-tools gating (CLAUDE.md rule 1)** — a lab's agent gates approvable
  tools through the `permission` map, never `tools:{x:true}`. The `cad` agent is the model:
  reads/measures/renders `"allow"`; `execute`/`export`/`import`/`load_part`/`install_skill`
  `"ask"`.
- **Detached / supervised stack** — sidecars run under the Electron `Supervisor`. A BYOK
  key or capability change **restarts `opencode-serve`**, killing the SSE stream and
  invalidating the session id; the renderer survives via the reconnect loop + `rebindSlot`.
  A new lab's create-effect must be idempotent on `primaryId` change (recreate + rebind on
  every reconnect).
- **Global model** — the active model is app-wide (threaded per-prompt); a lab does **not**
  get its own model selector.
- **Theme** — locked `nightjar-*` palette as CSS vars mapped to Tailwind with
  `<alpha-value>`. New lab UI uses these tokens (the `nightjar-→june-` rename is a separate
  stage; `main/index.ts` `backgroundColor` must track `--nj-base`).

---

## 8. Safety & guardrail model (built in from day one)

Bio Lab, Chem Lab, and Physics are all **dual-use**. The decision on record: **build the whole thing
first — it will not be public yet — then red-team and decide what to release and what
guardrails to keep.** Building it now does **not** mean building it unguarded. Guardrails
are **designed in from day one, not bolted on after.** The clean UI (§4.5 — no scary
ribbon/banner) is a *presentation* choice; the enforcement below is always active.

**Core invariants (must hold in the built system):**

1. **In-silico only — NO real-world actuation.** No DNA-synthesis ordering, no lab-hardware
   or robot control, no network egress. "Run/execute an experiment" means **simulation
   only**. (This is also why Robotics under Mechanical is planning/kinematics only.) The
   CSP loopback-only network policy (§7.5) enforces no-egress **for the renderer** — but
   **not** for backend MCP subprocesses, which are not network-sandboxed today (`cad.ts`'s
   `execFile` has a wall-clock timeout, no netns). So backend "offline" is currently
   *trusted (tool-selection + code-audit), not structurally enforced.* Enforcing it (a
   no-net wrapper on the phase-\* launchers) is an open decision — see §9.6.
2. **Deterministic per-discipline hazard screen.** Each dual-use lab passes designs / edits /
   generated protocols / solver runs through a deterministic rule-based gate *before* acting
   — not an LLM judgment call. Bio: `bio_hazard_screen`; Chem: `chem_hazard_screen` (§9.6);
   Physics: `physics_hazard_screen` (§5.8).
3. **Refusal policy.** Refuse to **design / engineer / generate protocols for** hazards:
   select agents, known toxins, and gain-of-function (↑ transmissibility / lethality /
   host-range / immune-evasion). **Read-only visualize/analyze of existing public data is
   OK**; *creating* uplift is not.
4. **Audit log** of every flagged / refused request (survives the session).
5. **Benign demos only** — insulin / GFP / pUC19 (§6.4).
6. **Dual-use tools are kept-but-gated during the private build; release is decided after
   red-teaming.** *(Amended 2026-07-15.)* Given the on-record posture — "build the whole
   thing first, keep it non-public, then red-team and decide what to release and which
   guardrails to enforce" — a legitimate **dual-use** tool (e.g. retrosynthesis:
   AiZynthFinder, ReactionT5) is **not declined at build time.** It is **gated**: permission
   `"ask"` + a deterministic **red-teamed** screen + an audit log + **kept private**, with
   the residual risk explicitly accepted (an offline/AGPL screen is user-removable, no
   server-side kill-switch). Only a feature with **no legitimate use** — one whose *sole*
   purpose is harm — is declined outright. **What ships publicly, and with which guardrails
   enforced, is a separate decision made after red-teaming, not now.**

**How this composes with existing mechanisms:** items 2–4 (deterministic screen, refusal,
audit) are applied per dual-use discipline — Bio, Chem (§9.6), and Physics (§5.8) — and
extend, not replace, the CAD agent template. The existing **permission approval modal**
(PermissionContext) still gates every mutating tool as `"ask"`; the **`"*": "deny"`**
default in the agent's permission map still means any unlisted tool is unreachable; and the
**wall-clock timeouts** (rule 3) and **sandbox** (no fs/os/net in `execute`) still apply.
The biosecurity screen sits *in front of* those as an additional deterministic layer.

**New hazards to track (CLAUDE.md rule 7 — flag, don't silently fix or ignore):** bundling
**Mol\*** adds a substantial new WebGL dependency that must be verified fully offline under
CSP + SwiftShader; and `phase-bio`'s tool surface must be audited the same way the CAD
agent's 38→20 reachable-tool reduction was (deny-by-default, explicit allow/ask). These get
named items when we write the implementation plan, and any defect found in shipped work
goes to `KNOWN_ISSUES.md` in NJ-\* format.

---

## 9. Chem Lab (planned — "CAD for chemistry")

Chem Lab is the CAD interaction model aimed at chemistry: **natural language → the agent
picks a local chemistry tool → a viewer opens → interactive visualization → an inspector
with properties.** It reuses the shared shell (§4), the add-a-lab wiring (§7), and the §8
safety model (sharpened for chem in §9.6). It is entirely in-silico.

```
"Draw caffeine"  →  agent calls a chem tool  →  Molecule Viewer opens
                 →  2D + 3D structure render →  Properties fills (MW, formula, logP, TPSA)
"Explain this reaction" → Reaction Viewer → depiction + explanation
"Compare ethanol and methanol" → Comparison Viewer (side-by-side)
```

> **Status: kept-in-plan, deferred — not a V1 build order.** The 14 tools the user named
> split along JUNE's constraints (React-only renderer, Python+Node runtimes only, offline
> CSP, 6 GB GPU, AGPL compatibility, and the §8 dual-use rules). **Four conflict** —
> Elementari (Svelte), Catalyst.jl (Julia), Reaktoro (conda/C++), and AiZynthFinder
> (dual-use retrosynthesis). **User decision (2026-07-15): keep all four**, each via a
> **wrapper** (feasibility verified — see §9.3), but **build them in a later phase, after
> the Telegram work**; V1 leads with the lighter pip substitutes. A few decisions remain
> open (§9.8). **Nothing here is implemented.**

### 9.1 Discipline tree

- **Molecules** — draw / fetch / depict a structure (2D + 3D), compute properties.
- **Reactions** — depict a reaction, explain it, predict products, show a route.
- **Simulation** — conformers / trajectories / property calculation (compute-only).
- **Visualization** — the shared rendering surface the above feed into.

### 9.2 Viewers (pluggable via the ViewerManager, §7.4)

| Viewer | Renders | Render path | Notes / architectural break |
|--------|---------|-------------|-----------------------------|
| **Molecule 2D** | 2D depiction of a SMILES/MOL | **server-side RDKit-Python → SVG sidecar** (mirrors `step_to_glb.py`; rule-3 timeout; no renderer WASM) → inline SVG | new **non-WebGL, non-GLB** viewer class the ViewerManager must admit |
| **Molecule 3D** | 3D structure | **Mol\*** (React + WebGL); optional RDKit ETKDG 3D-embed sidecar for SDF/PDB | inherits NJ-31 SwiftShader; needs `worker-src blob:`; remote data providers **disabled** |
| **Molecule Editor** | interactive draw → **emit** structure | **Ketcher** (React) | **inverts CAD's one-way dataflow** — the viewport becomes an *input source*; needs a **new viewer→agent reverse channel** that doesn't exist today; Ketcher-standalone runs Indigo **WASM** → forces a CSP relaxation. **Placeholder in V1** unless the CSP + reverse-channel work is approved (§9.8 decisions 1–2) |
| **Reaction** | reaction depiction / product / route | RDKit reaction-SVG sidecar; multi-step route = a **route-graph** viewer (nodes = molecule SVGs, edges = reactions) | route/product generation is dual-use → §9.6 screen. Depiction can be real in V1; **prediction is placeholder** |
| **Simulation** | conformer/trajectory or property chart | animated Mol\* (3D) or a 2D chart | heavy compute stays in the MCP under rule-3 timeout; big ML weights = NJ-32. **Placeholder in V1** |
| **Comparison** | N molecules side-by-side | 2D SVG grid (cheap) or 3D overlay (needs an alignment sidecar) | **breaks CAD's single-artifact state** — ViewerManager `extract` must return **multiple** artifacts + per-viewer state holds a **collection** (today `cadModel` is one slot) |

Three of these force the **ViewerManager (§7.4)** to generalize beyond the CAD assumption,
so flag them as *real additions*, not free reuse: (1) a **non-WebGL 2D** viewer class,
(2) an **artifact collection** (Comparison), (3) a **reverse emit channel** (Editor —
today `ArtifactContext`/`SessionsContext` only push tool-calls *into* viewers, never pull
artifacts *out*).

### 9.3 Tools — bucketed against JUNE's constraints

The 14 named tools, bucketed. **Licenses must be read from the actual LICENSE file at
integration time (CLAUDE.md rule 5)** — the notes are best-known and several are
unverified. For ML tools the **weight/data license** (often CC-BY-**NC** / research-only,
which is AGPL-incompatible) is the *real* gate, separate from the code license.

**✅ V1 — offline, pip-only, permissive:**
- **RDKit** (Python bindings, BSD-3) — parsing, descriptors, 2D depiction, 3D embed,
  reaction drawing. The workhorse. **Caveat:** its `RunReactants`/reaction-SMARTS is itself
  a product/route-generation primitive → must sit behind the §9.6 screen, same as the ML
  tools. Use Python bindings, **not** RDKit-JS (WASM, CSP-blocked).
- **Chemlib** (pure-Python, MIT — *verify*) — stoichiometry / molar-mass / balancing.
  Trivial fit; educational depth (complements, doesn't anchor).
- **Mol\*** (MIT, React + WebGL) — the 3D viewer. **Offline-conditional:** disable its
  remote PDB/AlphaFold/PubChem providers, self-host all assets (no CDN), add
  `worker-src 'self' blob:`.
- Server-side **RDKit → SVG/SDF sidecar** — the 2D/3D conversion path; no WASM, keeps the
  rule-3 wall-clock timeout on every conversion.

**🔌 Kept — but deferred to a later phase (after the Telegram work).** These include the
four tools that **conflict** with JUNE's constraints; the user's decision (2026-07-15) is
to **keep all four in the plan** and build them **later, after Telegram**. Each is buildable
via a **wrapper** (feasibility verified), but the wrapper **embeds** the foreign runtime
rather than removing it — so **V1 leads with the lighter pip substitute** noted, and the
wrapper lands in the later phase.

- **Elementari / MatterViz** (Svelte 5, MIT) — *wrapper:* imperatively `mount()` its Svelte
  components into a React `<div>` (Vite runs the React + Svelte plugins together). *Cost:*
  embeds a **second UI framework** + three.js in the renderer; its HDF5/symmetry features
  use **WASM the CSP blocks**; it is crystallography-scoped. *V1 substitute:* RDKit-Python
  depiction images + a small React periodic table (zero Svelte, no WASM). *Later:* wrap it
  if crystal / periodic-table views are wanted.
- **Catalyst.jl** (SciML, MIT) — *wrapper:* drive it from Python via **`juliacall`** in a
  phase-cad-style MCP (backend-only; renderer CSP N/A). *Cost:* **embeds a full ~3–6 GB
  Julia runtime** (compiler + JIT), not a thin binding; slow first-run JIT; **no GPU payoff**
  on the 6 GB WSLg box. *V1 substitute:* pure-pip **`basico` (COPASI)** or **GillesPy2** for
  reaction-network simulation — the true "compiled-lib + bindings" form, ~tens of MB.
  *Later:* wrap Catalyst when SciML's symbolic / bifurcation / AD-fitting power is needed.
- **Reaktoro** (C++/pybind11, LGPL-2.1) — *wrapper:* give this one MCP its **own
  micromamba/conda env** and point the launcher at `env/bin/python` (no activation; same
  shape as phase-cad; CSP N/A). *Cost:* introduces **conda** to an all-pip build + a
  ~1.5–2 GB vendored env; LGPL-2.1 relinkability obligation (ship it as an unmodified,
  replaceable shared library — AGPL-safe). *V1 substitute:* pip-only **`thermo`**
  (+ **`phreeqpython`** / `pyEQL` for aqueous geochemistry) — no conda. *Later:* wrap
  Reaktoro when rigorous multiphase / electrolyte equilibrium is genuinely needed.
- **AiZynthFinder** (MIT code, retrosynthesis) — **kept; invariant-6 amended (§8).**
  *wrapper:* ordinary Python MCP, **CPU-only onnxruntime — no torch/GPU** — drops in like
  phase-cad. *Cost:* ~1.1–1.3 GB vendored data; **the ZINC stock (~0.66 GB) carries a
  redistribution restriction** (bundling in a conveyed build needs written permission);
  trained models/templates are **CC-BY-4.0** (attribution). *Safer form:* ship
  **AiZynthExpander** (single-step) to **drop the ZINC stock — and its license problem —
  entirely**, expanding to the full multi-step planner once ZINC is cleared. *Safety:* gated
  `"ask"` + deterministic **red-teamed** `chem_hazard_screen` + audit log + **kept private**,
  with the residual (an offline/AGPL screen is user-removable) explicitly accepted (§9.6).
- **ReactionT5** (forward **and** retro) / **Rxn-INSIGHT** — kept-but-gated `"ask"` + screen;
  pull PyTorch/transformers (NJ-32); **weight/dataset license must clear non-commercial
  before any bundling.** (Retro is kept-but-gated now, per the amended invariant-6.)
- **Miew** (MIT — *verify*) — redundant 3D viewer (vanilla-JS core, needs `miew-react`);
  same WebGL + remote-data caveats. Prefer **Mol\*** first.

**🚩 Flag-clarify — still owed (see §9.8):**
- **Ketcher** — the interactive editor; the **only** real driver for relaxing the CSP
  (Indigo WASM) *and* it needs the new viewer→agent reverse channel. Verify the bundled
  `indigo-ketcher.wasm` license (Indigo was **GPLv3 before its ~2020 Apache relicense**).
- **ChemMCP** — native MCP fit, but most of its tools require remote services (ChemSpace,
  IBM RXN4Chem, Tavily), an external LLM (LiteLLM/GPT-4o), or Docker. Enable **only** its
  offline RDKit-backed subset.
- **Atom Simulator** — ambiguous name (several unrelated, often-unlicensed toy repos); pin
  the exact repo or drop.
- **MOSAIC** — ambiguous name; the most likely match is a stale Py2-era molecular
  *data-model*, **not** a synthesis tool. Pin or drop.
- **CSP relaxation scope** and **backend egress enforcement** — see §9.4 and §9.6.

### 9.4 The CSP / WASM decision (an architectural fork the user must choose)

Verified against source: the renderer CSP (`phase3-ui/src/renderer/index.html:6`) is
`… script-src 'self' …` with **no `wasm-unsafe-eval`** and **no `worker-src`**. Under
Electron 33 / Chromium 130:

- **WASM instantiation is blocked** (the `.wasm` *fetch* is fine; instantiation throws) →
  RDKit-JS and Ketcher-standalone's Indigo fail. Fix: `script-src 'self' 'wasm-unsafe-eval'`.
- **`blob:` web workers are blocked** (`worker-src` falls back to `script-src 'self'`) →
  Mol\*/Miew/Ketcher compute workers fail. Fix: `worker-src 'self' blob:`.
- **`data:`/`blob:` images are blocked** (`img-src` falls back to `default-src 'self'`) →
  depiction PNG thumbnails fail. Fix: `img-src 'self' data: blob:`.

**Two options:**

- **(A) Recommended — server-side sidecar, no CSP change.** Render all *non-interactive*
  2D/3D via the phase-chem RDKit-Python sidecar (SVG/SDF out); show inline SVG (already
  CSP-legal via `style-src 'unsafe-inline'`) and feed 3D coords to **Mol\*** (pure WebGL,
  no WASM). This keeps the strict CSP, keeps the rule-3 wall-clock timeout on all
  conversion (**a renderer WASM call is bounded by *no* timeout**), and covers
  Molecule/Reaction/Comparison/Simulation. Only `worker-src 'self' blob:` is needed (for
  Mol\*).
- **(B) Relax the CSP** (`wasm-unsafe-eval` + `worker-src blob:` + `img-src data: blob:`)
  to run RDKit-JS/Ketcher in-renderer. **This is a whole-renderer security downgrade** — it
  weakens every future XSS surface, not just the chem viewport — a rule-1/rule-7 change the
  user must **explicitly approve**. Only **Ketcher** (interactive drawing) truly forces it.

**Hazard (CLAUDE.md rule 7):** the existing live-preview iframe (`preview-server.ts`)
serves from a loopback origin with **no CSP header** and `Access-Control-Allow-Origin: *` —
documents there already run unsandboxed WASM + `blob:` workers + loopback network. Leaning
on it as a WASM host is an *existing hole becoming load-bearing*; if used, log it as a
`KNOWN_ISSUES.md` NJ-\* item rather than treating it as free.

### 9.5 phase-chem MCP

A new Python MCP mirroring `phase-cad` (§7.2): its own venv, a thin launcher shim, one
`mcp.chem` block + one `agent.chem` block in `opencode.json`. **pip-only** — RDKit now
ships PyPI wheels, so the V1 set needs **no conda**. The `chem` agent's permission map is
`"*": "deny"` + read-only analysis/depiction `"allow"`, every generative/mutating tool
`"ask"` (CLAUDE.md rule 1). A trusted RDKit → SVG/SDF converter sidecar mirrors
`step_to_glb.py` (`execFile` + rule-3 timeout + self-validating output bytes).

### 9.6 Chem safety model (extends §8; corrections the audit forced)

Chem is dual-use exactly as Bio is. The §8 invariants map directly, with three sharpenings
the adversarial audit surfaced:

1. **`chem_hazard_screen` sits in front of ANY route/product-generating call — including
   RDKit's `RunReactants`, not just the named ML tools.** It is a deterministic, rule-based
   gate (structural-alert/SMARTS for explosophores + a controlled-substance / CWC
   Schedule-1/2/3 precursor list), run *before* the agent acts.
2. **This screen is the hardest and riskiest deliverable, not a checkbox.** SMARTS/precursor
   lists are trivially evaded by tautomers, salts, protecting groups, and stepwise routes;
   a screen that *looks* right but misses obvious precursors gives **false assurance —
   worse than none** (a direct CLAUDE.md rule-6 case). It must be **red-teamed against the
   real evasions** as an explicit gate before Chem Lab is considered safe — never marked
   done from the ruleset alone.
3. **The high-uplift retro engines are kept-but-gated, not declined** *(invariant-6 amended
   2026-07-15 — §8, §9.3)*. AiZynthFinder and ReactionT5 stay in the plan (deferred, later
   phase), gated `"ask"` + red-teamed screen + audit + **kept private**. The honest residual:
   because Chem Lab is offline + AGPL, that screen is **user-strippable with no server-side
   kill-switch** — accepted under the build-first / red-team-later / not-public posture.
   Whether to release these publicly (and with which guardrails enforced) is decided **after
   red-teaming**, not now.

**Correction to §8 invariant 1 / §7.5 (the audit caught my overclaim):** the loopback-only
CSP enforces no-egress **for the renderer only**. Backend MCP subprocesses (the phase-chem
venv) are **not network-sandboxed today** — so backend "offline" is currently *trusted
(tool-selection + code-audit), not structurally enforced.* If we want true enforcement
(important once ChemMCP or ML tools enter the tree), the phase-chem launcher needs a real
egress block (run the MCP in a network namespace / no-net wrapper). **Open decision (§9.8).**

Everything else composes as in §8: the PermissionContext modal still gates mutating tools
`"ask"`; `"*": "deny"` keeps unlisted tools unreachable; rule-3 timeouts apply; benign
demos only. Per rule 7, the phase-chem tool surface is audited deny-by-default, and any
defect in shipped work is logged `NJ-*` in `KNOWN_ISSUES.md`.

### 9.7 Demos (benign only)

Aspirin, caffeine, ibuprofen, plus textbook named reactions (e.g. Fischer esterification)
— the chem analog of Bio's insulin/GFP/pUC19.

### 9.8 Decisions owed to the user (before this becomes a build plan)

**Resolved 2026-07-15:** the four conflicting tools (Elementari, Catalyst.jl, Reaktoro,
AiZynthFinder) are **kept via wrappers, deferred to a later phase after Telegram** (§9.3);
§8 invariant-6 is amended so dual-use retrosynthesis is **kept-but-gated**. Still open:

1. **CSP fork (§9.4):** server-side-sidecar-only (recommended, no CSP change) **vs** relax
   the renderer CSP for in-renderer WASM/Ketcher (a whole-renderer security downgrade).
2. **Ketcher:** in or out for V1? It's the only tool forcing *both* the CSP relaxation and
   a new viewer→agent reverse channel.
3. **Backend egress:** enforce (netns/no-net wrapper on phase-chem) or trust (tool-audit)?
4. **Ambiguous names:** pin the exact repo for **Atom Simulator** and **MOSAIC**, or drop.
5. **ML-tool + data licenses (before bundling, later phase):** ReactionT5 / Rxn-INSIGHT
   weight/dataset license must clear non-commercial (NJ-32 also applies — 6 GB GPU, PyTorch
   weights); and AiZynthFinder's **ZINC-stock redistribution** must be cleared for the full
   planner — or ship the single-step **AiZynthExpander** to avoid it (§9.3).
6. **`chem_hazard_screen` ruleset:** which structural-alert/SMARTS sets + which
   controlled-substance/precursor lists — the safety-critical spec that needs red-teaming.

---

## 10. What we are NOT doing yet (scope guardrails for this doc)

- **Not building anything** — this is design only.
- **Not removing the CAD tab yet** — CAD stays top-level until LAB's shell is proven; the
  fold-into-Mechanical is a later, deliberate step.
- **Safety posture** — CLAUDE.md rules 1 (permission-gating), 3 (timeouts), and 7 (flag
  hazards) **stand**, and guardrails still ship *with* the labs (gate + screen + audit +
  private). One deliberate change (2026-07-15): §8 invariant-6 now **keeps dual-use tools
  gated** rather than declining them at build time — the public-release + enforced-guardrail
  decision is deferred to after red-teaming, not removed.
- **Not making per-lab models / networked features** — global model + loopback-only stand.
- **Not starting the LAB build before Telegram** — the whole LAB implementation
  (Mechanical/Physics, Bio, Chem — including the four deferred Chem wrappers) is scheduled
  *after* the current Telegram work (user, 2026-07-15).
- **Weapon/explosive/nuclear-device design is out of scope — a hard boundary, not a pending
  decision.** Physics is scoped to *simulate the phenomenon, not engineer the device* (§5.8).
  A 2026-07-15 request to put device design/optimization in scope was **declined and stays
  declined**; it is not adopted regardless of the "simulation" framing.

---

## 11. Next step (after this doc is agreed)

**Sequencing:** the entire LAB build below (Mechanical/Physics, Bio, Chem) is scheduled
**after the current Telegram work** (user, 2026-07-15). The four deferred Chem wrappers are a
**later sub-phase** within it.

1. User resolves the open decisions: **§9.8** (Chem — CSP fork, Ketcher, backend-egress,
   ambiguous names, ML/data licenses, `chem_hazard_screen` ruleset) and the **§5.8 Physics
   `physics_hazard_screen` device-signal list** (the *scope* is already settled — device
   design is declined, §5.8; only the screen's detection ruleset is a build detail).
2. We turn this doc into an **implementation plan broken into focused PRs** — one at a time,
   no stacking, each BugBot-gated, per the project merge rules. Likely PR seams:
   (a) LAB tab + launcher shell; (b) generalized history rail + the per-lab **Projects**
   system (projects store + home grid, per-project Memory/Instructions/Files,
   `(slot, projectId)`-keyed sessions — §4.6, **core v1**); (c) unified
   Inspector; (d) `ViewerManager` refactor of the two existing handoffs — generalized to
   admit a **non-WebGL 2D viewer**, an **artifact collection**, and a **reverse emit
   channel** (§9.2); (e) move CAD into Mechanical; (f) `phase-bio` MCP + `bio` agent +
   `bio_hazard_screen` + audit log; (g) Bio viewers (Protein/Sequence/Plasmid/Circuit) +
   demos; (h) `phase-chem` MCP (RDKit + Chemlib, pip-only) + `chem` agent +
   `chem_hazard_screen` (red-teamed) + audit log; (i) Chem Molecule viewer (2D SVG sidecar
   + Mol\* 3D) + Comparison; (j) Chem placeholders (Editor/Reaction/Simulation) wired as
   honest stubs; (k) *(conditional on §9.8)* CSP relaxation + Ketcher editor + the
   viewer→agent reverse channel; **(l)** *(later sub-phase)* the four deferred Chem wrappers —
   Elementari (Svelte→React), Catalyst.jl (`juliacall`), Reaktoro (micromamba env), and
   AiZynthFinder (CPU MCP + red-teamed screen; ZINC cleared or single-step Expander) — each
   replacing its lighter V1 substitute;
   **(m)** `phase-physics` MCP (pip: SciPy/SymPy/PyBullet/MuJoCo/Pymunk/SfePy/py-pde/rayoptics/
   hapsira/ikpy) + `physics` agent + `physics_hazard_screen` + audit log;
   **(n)** Physics viewers (trajectory player, field/heatmap/vector, FEA stress) — the
   ViewerManager time-series + field generalization (§5.6);
   **(o)** *(optional/later)* in-renderer live-sim (matter.js/cannon-es, §5.5) + the
   conda/binary-wrapped heavy solvers (CalculiX/DOLFINx/Meep/OpenMC, §5.4). Exact
   ordering/seams are decided when we write the plan.
3. **Even later — the v3-parked disciplines (§12):** Electronics, Semiconductors, and
   Architecture/Civil, sequenced after all of the above, with their own decisions still
   owed (§12.5).

---

## 12. Appendix — v3-parked future disciplines (Electronics · Semiconductors · Architecture/Civil)

> **Status: v3-parked design reference — not built, not scheduled.** Sequenced **after v1
> ships** (CAD fidelity, Telegram go-live) **and after the existing v3 labs**
> (Physics/Chem/Bio). Merged from two research passes (Claude + Perplexity), then **every
> tool re-verified against its actual repo this session** — corrections and two
> non-commercial-license traps are folded in. Decisions marked *(user, 2026-07-15)* are
> settled; a few remain owed (§12.5).

**Design pattern (same as CAD):** prompt → LLM writes code → a kernel/tool executes → a
viewer renders → **export real files**. Reuses the three.js viewer, the
Python-MCP-subprocess-emits-data pattern, and (Architecture) the OCCT kernel family.

**Cross-cutting principles:**
- **License firewall** — permissive (MIT/BSD/Apache/ISC/Boost/Artistic/EUPL/MPL/LGPL) can
  bundle or dynamic-link; GPL/copyleft runs as a **subprocess** over a CLI/file boundary
  (mere aggregation, AGPL-safe), exactly as JUNE already does. **No GPL-2-*only*** appears
  anywhere in these three labs (the one true AGPL-3 incompatibility). **Non-commercial /
  field-of-use** licenses are AGPL-incompatible → **excluded** (the two traps below).
- **Curate generators, don't free-generate** — LLM output is reliable for *bounded* blocks
  (a filter, an FSM, a portal frame), not *whole systems* (a full board/chip/building) — the
  same ceiling as complex CAD assemblies. Ship curated parametric generators + a hero demo;
  open-prompt only the simple cases.
- **Conservative capability read** — headline pass-rates (90%+) are on saturating
  benchmarks; hard out-of-distribution prompts cap around **~34%**. Plan for the low number,
  with a simulate/verify-and-repair loop as the gate.

### 12.1 Electronics / PCB

**Pipeline:** prompt → **SKiDL** (Python → netlist + ERC) → **KiCad/kicad-cli** (DRC +
Gerber/BOM) → validate with **ngspice** → **export the orderable package** (the user
submits it). Render: SVG schematic (schemdraw + tscircuit's pure-SVG viewers), three.js 3D.

**Decisions (user, 2026-07-15):** **SKiDL** is the code-native anchor; **KiCad stays** as
the mature DRC/ERC + Gerber backbone (tscircuit's ERC/DRC is explicitly immature → can't be
dropped); **export-only** — V1 produces the fab package but does **not** auto-submit to
JLCPCB/PCBWay (egress + spend, breaks loopback-only); bundled autorouter is the MIT
**tscircuit-autorouter**, with **Freerouting** offered as an **opt-in** (user supplies a
Java/JRE — a new runtime, never bundled-core).

| Tool | License (verified) | Runtime | Role | Bundling |
|------|--------------------|---------|------|----------|
| **SKiDL** | MIT ✅ | Python | LLM target → netlist/ERC — the anchor | bundle (phase-cad MCP) |
| **KiCad / kicad-cli** | GPL-3-or-later | C++ binary | authoritative DRC/ERC + Gerber/BOM | **subprocess** (aggregation) |
| **ngspice** | modified-BSD ✅ | C binary | SPICE validation pre-export | subprocess binary (**not** PySpice — GPLv3, in-process, avoid) |
| **schemdraw** | MIT ✅ (`cdelker/schemdraw`) | Python | schematic → SVG (CSP-safe) | bundle |
| **tscircuit** (viewers) | MIT ✅ | Node | pure-SVG schematic/PCB viewers (CSP-safe) | bundle viewers; **eval engine as a Node subprocess** (triple CSP-blocked in-renderer) |
| **tscircuit-autorouter** | MIT (*verify LICENSE — rule 5*) | Node | bundled autorouter (degrades >~50 traces) | bundle (default) |
| **Freerouting** | GPL-3-or-later | **Java** | dense-board autorouting | **opt-in** — new-runtime (JRE), user-supplied |
| **atopile** | MIT ✅ | Python | alt `.ato` HDL front-end (**not chosen**) | — |

**Conflicts:** Java (Freerouting → opt-in); cloud tiers + fab ordering (egress → export-only,
`auto-local` router, vendored `@tsci/*` deps); tscircuit-eval CSP (→ Node subprocess; only
its SVG viewers render in-renderer).

### 12.2 Semiconductors / Digital Chip

**Pipeline:** prompt → Verilog → simulate (**Verilator**/**Icarus** + **cocotb**) → waveform
viewer → synthesis (**Yosys**) → **FPGA bitstream** (**nextpnr** — local flash, no egress)
**OR** ASIC (**OpenLane2** opt-in → GDSII → view in **KLayout**/**gdstk**). *JUNE designs;
the user fabricates.*

**Decisions (user, 2026-07-15):** the **FPGA + GDSII-authoring path is bundled core**
(Docker-free: Yosys→nextpnr + gdstk/KLayout + OpenROAD-alone as a CPU subprocess);
**OpenLane2 is opt-in** — the full RTL→GDSII flow needs a multi-GB **Docker/Nix** runtime
**and a mandatory ~1 GB PDK network pull** on setup (breaks pure-offline first-run), so it's
an opt-in local install, never bundled-core.

| Tool | License (verified) | Runtime | Role | Bundling |
|------|--------------------|---------|------|----------|
| **Verilator** | LGPL-3-only **OR** Artistic-2.0 (dual) | C++ binary | fast RTL sim (primary) | subprocess |
| **Icarus** | GPL-2-**or-later** | C++ binary | event-driven sim (complement) | subprocess |
| **cocotb** | BSD-3 ✅ | Python | Python testbench glue — the automation anchor | bundle |
| **Yosys** | ISC ✅ | C++ binary | synthesis (FPGA + ASIC front-end) | bundle binary |
| **nextpnr** | ISC ✅ | C++ binary | FPGA place-and-route → bitstream | bundle binary |
| **OpenLane2 / OpenROAD** | Apache-2.0 / BSD-3 ✅ | **Docker/Nix** | RTL→GDSII ASIC flow | **opt-in** (Docker + PDK pull); OpenROAD-alone runs as a CPU subprocess |
| **WaveDrom / vcdrom** | MIT ✅ | JS | waveform/timing viewers (CSP-safe) | bundle (*verify vcdrom is WASM-free*) |
| **Surfer** | EUPL-1.2 (AGPL-compatible ✅) | Rust | rich waveform viewer — **native subprocess** (WASM web build is CSP-blocked) | subprocess |
| **gdstk** | Boost-1.0 ✅ | Python (pip) | GDSII author/preview | bundle |
| **KLayout** | GPL-3-or-later + scripting exception | C++/Py | GDSII view + DRC/LVS | subprocess (scripting exempt) |

**LLM→Verilog reality:** usable only for **bounded** blocks (FSMs, ALUs, small cores) inside
a **simulate-and-repair loop** (cocotb + Verilator/Icarus as the gate); functional
correctness collapses on full-chip (~34% on hard benchmarks). Verilog ≫ VHDL (training data).
Curate generators + simulator-in-the-loop; never trust unattended full-chip synthesis.

**Conflicts:** Docker + mandatory PDK pull (OpenLane → opt-in); Surfer-WASM (→ native
subprocess); no GPL-2-only anywhere.

### 12.3 Architecture / Civil

**Pipeline:** prompt → **IfcOpenShell** Python (IFC/BIM model) → structural FEA (**PyNite**)
→ export **IFC/DXF** → **IfcOpenShell headless → GLB → the existing three.js viewer** (this
bypasses the web-ifc renderer-WASM wall entirely). Reuses the OCCT kernel *family*
(IfcOpenShell is OCCT-based — but its wheels bundle their **own** OCCT, not build123d's OCP
binary; disk cost only).

| Tool | License (verified) | Runtime | Role | Bundling |
|------|--------------------|---------|------|----------|
| **IfcOpenShell** | LGPL-3-or-later ✅ | Python/C++ | IFC authoring/geometry — anchor; headless IFC→GLB | bundle (own OCCT) |
| **PyNite** | MIT ✅ | Python | 3D frame/FE structural analysis — the standout | bundle |
| **ezdxf** | MIT ✅ | Python | DXF I/O + DXF→SVG (CSP-safe 2D preview) | bundle |
| **web-ifc-three** | wrapper MIT / **engine MPL-2.0** | **WASM-renderer** | IFC→three.js in-browser | **do-not-bundle** — WASM CSP-blocked; use IfcOpenShell→GLB |
| **sectionproperties** | MIT ✅ *but* mesher **Triangle = non-commercial** | Python | cross-section properties | **pending a permissive-mesher swap** — don't ship stock CyTriangle |
| **anaStruct** | LGPL-3-or-later (not GPL) | Python | 2D frames — **redundant** with PyNite | skip |
| **OpenSeesPy** | ⛔ **UC-Regents non-commercial / internal-only** | Python | nonlinear/seismic FEA | **EXCLUDED** (AGPL-incompatible — not even user-install) |
| **FreeCAD / Blender+Bonsai / Elmer** | LGPL/GPL copyleft | binary | heavier optional backends | do-not-bundle (subprocess-only if ever needed; heavy + redundant) |

**Safety framing (critical):** structural output is an **engineering aid, not a certified /
stamped design** — never imply code-compliance (Eurocode/AISC/ACI). Buildings need a licensed
engineer's sign-off; JUNE is concept/analysis, not stamped drawings. (OpenSees' own "research
purposes, do not rely exclusively" disclaimer validates this posture.)

**Conflicts:** web-ifc WASM (bypassed via IfcOpenShell→GLB); **two non-commercial traps** —
OpenSeesPy (excluded) and sectionproperties' Triangle mesher (pending swap).

### 12.4 Safety scope (all three labs)

Clean general-purpose engineering domains (circuit / RTL / structural simulation +
fabrication descriptions) — they map to **§5.8** as *simulating the phenomenon and producing
general-purpose fab outputs*, not engineering a proscribed device. The **structural
engineering-aid, non-stamped** posture (§12.3) is the §5.8 line applied to buildings. The one
carve-out is **weapons/munitions at the tool-intent level**: exclude tools whose *purpose* is
engineering a weapon / target-vulnerability (e.g. **BRL-CAD** — deliberately left out despite
being open-source, as it is weapon-system oriented), consistent with §5.8 "simulate the
phenomenon, not engineer the device." General-purpose SPICE/RTL/FEA are dual-use like the
existing CAD lab and are governed by §5.8 at the user-intent level, not by tool exclusion.

### 12.5 Staged rollout, thresholds, and decisions still owed

**Staged rollout** (order, not dates): **(A)** Electronics (most mature, reuses SVG/three.js);
**(B)** Architecture (reuses OCCT family, permissive core) + the FPGA/chip-simulation subset;
**(C)** ASIC layout (OpenLane2) as an **opt-in** Docker/Nix backend — never core.

**Thresholds that change the plan:** tscircuit gains mature ERC/DRC → reconsider it as the
primary Electronics engine and drop KiCad; OpenLane ships a light pip distribution →
reconsider bundling ASIC; a **permissive** nonlinear FEA emerges → add seismic to
Architecture (until then OpenSeesPy stays out); LLM RTL/netlist pass-rates on *hard*
benchmarks rise materially above ~34% → expand from curated generators toward open-ended.

**Decisions still owed (when we build this):**
1. **CSP fork** — ties to the standing **§9.4** decision; needed only for *in-renderer*
   web-ifc-three / Surfer-web / RDKit-JS. Default = **keep strict CSP + subprocess/GLB
   bypass** (every WASM tool here has one), so the fork isn't forced.
2. **VCD waveform viewer** — **Surfer native subprocess** (default; scales on big dumps) vs
   **vcdrom** in-renderer (only if verified WASM-free — audit confidence was medium).
3. **sectionproperties** — invest in a permissive-mesher swap (verify the replacement's own
   license/linkage first — the mooted gmsh is GPL-2-or-later + in-process) vs drop
   cross-section analysis and ship PyNite (frame FE) alone for V1.
4. **Rule-5 LICENSE-read debts before ship** — open the actual LICENSE for
   tscircuit-autorouter (bundling on an unread license), Verilator, Surfer, OpenLane2,
   Blender/Bonsai, Elmer (verdicts almost certainly right + all AGPL-safe, but unread).
