#!/usr/bin/env python
r"""Offline smoke test for the Prompt-to-CAD env (Task 5). No network, no MCP host.

Proves the pinned stack actually works on this machine end-to-end at the library level:
  1. build123d imports (OCP/VTK resolve) and builds real geometry,
  2. a named 2-part assembly exports to a hierarchical STEP,
  3. the STEP -> GLB converter (rebuild tree + validate bytes) yields per-part named GLB
     nodes — the NJ-18 mitigation, exercised here so a broken env fails loudly at setup,
  4. build123d_mcp imports.

Run (POSIX):    phase-cad/.venv/bin/python phase-cad/smoke_test.py
Run (Windows):  phase-cad\.venv\Scripts\python.exe phase-cad\smoke_test.py
Exit: 0 on success; non-zero (with the failing step) otherwise.

The full MCP tool-loop verify (execute → measure → export via the real server tools) is
`research/probes/probe_full_cad_loop.py` — that one needs BUILD123D_IN_PROCESS=1.
"""
import json
import struct
import sys
import tempfile
from pathlib import Path

GLB_MAGIC = 0x46546C67


def _glb_summary(path: Path) -> tuple[list[str], int]:
    data = path.read_bytes()
    if len(data) < 20 or struct.unpack("<I", data[:4])[0] != GLB_MAGIC:
        raise RuntimeError("not a GLB file")
    chunk_len, _ = struct.unpack("<II", data[12:20])
    gltf = json.loads(data[20 : 20 + chunk_len])
    names = [n.get("name") for n in gltf.get("nodes", [])]
    return names, len(gltf.get("meshes", []))


def main() -> int:
    print("1. import build123d …", end=" ", flush=True)
    from build123d import Compound, Cylinder, Pos, Solid, export_gltf, export_step, import_step

    print("ok")

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)

        print("2. build a named 2-part assembly + export STEP …", end=" ", flush=True)
        sun = Cylinder(radius=8, height=6)
        sun.label = "sun_gear"
        planet = Pos(16, 0, 0) * Cylinder(radius=4, height=6)
        planet.label = "planet_gear_1"
        asm = Compound(children=[sun, planet])
        asm.label = "assembly"
        step = tmp / "asm.step"
        export_step(asm, str(step))
        assert step.stat().st_size > 0, "STEP not written"
        print("ok")

        print("3. STEP -> GLB (rebuild tree + validate bytes, NJ-18) …", end=" ", flush=True)
        reimported = import_step(str(step))
        kids = []
        for child in reimported.children or [reimported]:
            part = Solid(child.wrapped)  # rebuild from the raw OCCT handle
            part.label = child.label  # the import_step tree itself exports an EMPTY glb
            kids.append(part)
        rebuilt = Compound(children=kids)
        rebuilt.label = reimported.label or "assembly"
        glb = tmp / "asm.glb"
        export_gltf(rebuilt, str(glb), binary=True)  # return value is NOT trustworthy
        names, meshes = _glb_summary(glb)
        got = {n for n in names if n}
        want = {"sun_gear", "planet_gear_1"}
        assert want <= got, f"per-part names lost: got {got}, wanted {want}"
        assert meshes >= 2, f"expected >=2 meshes, got {meshes}"
        print(f"ok  (nodes={names}, meshes={meshes})")

    print("4. import build123d_mcp …", end=" ", flush=True)
    import build123d_mcp  # noqa: F401

    print("ok")

    print("\n✅ phase-cad smoke test passed.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # noqa: BLE001 — surface the failing step clearly at setup
        print(f"\n❌ FAILED: {exc.__class__.__name__}: {exc}")
        sys.exit(1)
