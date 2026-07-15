# phase-cad — Prompt-to-CAD (Task 5)

The Python environment for Nightjar's "Iron Man" conversational-CAD feature. A dedicated
**Python 3.12** venv (via `uv`) containing **build123d** (code-CAD over OpenCASCADE) and
**build123d-mcp** (the MCP tool loop the chat model drives: `execute` → `render_view` →
`measure` → `export`).

This directory is **env + verification only**. The app wiring lands in later PRs:
- `opencode.json` — the build123d-mcp MCP server + a `cad` agent (permission `ask` on
  `execute`/`export`).
- The trusted **STEP → GLB** converter + Electron IPC.
- The three.js viewer.

## Setup

```sh
phase-cad/setup.sh          # from the repo root — creates phase-cad/.venv and smoke-tests it
```

## Why these exact pins

Verified end-to-end **headless on 2026-07-15** (`smoke_test.py`; full MCP loop in
`phase-cad/probes/probe_full_cad_loop.py`).

- **Python `==3.12.*`** — the widest-tested intersection across build123d, build123d-mcp,
  OCP, and VTK wheels. 3.13/3.14 wheels exist but VTK support there is thinner; 3.12 is the
  conservative choice, and build123d-mcp's own README recommends it. Do **not** use 3.13+.
- **`build123d>=0.11,<0.12`** — 0.11 switched from `cadquery-ocp` to **`cadquery-ocp-novtk`**;
  the range holds us on that ABI.
- **`build123d-mcp==0.3.79`** — pinned exactly. Its `export` tool is `("step","stl","dxf",
  "svg")` — **no GLB** — so Nightjar converts STEP → GLB itself (see NJ-18). It re-licensed
  MIT → **Apache-2.0** in May 2026; 0.3.79 is clean Apache-2.0 (LICENSE read directly),
  but re-check the license on any bump.
- **`cadquery-ocp-novtk != 7.9.3.1.1`** — that version ships a **broken, un-yanked** macOS
  wheel (missing `OCP.GccEnt`). Excluded exactly as upstream build123d-mcp does. macOS is
  out of v1 scope, but the constraint costs nothing.

## Runtime note (load-bearing for the MCP wiring)

The build123d-mcp server **must run with `BUILD123D_IN_PROCESS=1`** under Nightjar. Its
default mode spawns a worker subprocess (multiprocessing) that fails to start under
stdio/sandboxed MCP hosts (upstream issue #143). The `opencode.json` MCP entry sets this
env var. No GPU is needed — OCCT is CPU-only.

## Licenses / attribution

All CAD dependencies are inbound-compatible with Nightjar's **AGPL-3.0-or-later** (read
from the projects' actual LICENSE files, per CLAUDE.md rule 5):

| Component | License | Notes |
|---|---|---|
| build123d | Apache-2.0 | code-CAD kernel wrapper |
| build123d-mcp | Apache-2.0 (was MIT until 2026-05) | the MCP tool loop; re-check license on upgrade |
| cadquery-ocp-novtk (OCP) | Apache-2.0 | OpenCASCADE Python bindings |

No branding locks, user-count gates, or field-of-use restrictions. See
`NIGHTJAR_LICENSE_AND_ATTRIBUTION.md` for the project-wide attribution conventions.
