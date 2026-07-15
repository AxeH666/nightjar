"""Reproducer for NJ-18 (see KNOWN_ISSUES.md). Run this before trusting any STEP -> GLB path.

THE QUESTION: does STEP -> GLB preserve the PER-PART NAMED hierarchy?

Task 5's exploded view needs one named GLB node per part. The model can only emit STEP (the
build123d-mcp sandbox has no GLB export), so Nightjar converts STEP -> GLB itself in a
trusted converter. If that round-trip flattens the assembly or drops the part names, the
whole exploded-view design is wrong.

WHAT THIS FOUND (build123d 0.11.1, cadquery-ocp-novtk, Python 3.12):

  1. The naive round-trip produces an EMPTY GLB — 0 nodes, 0 meshes — even though the
     re-imported tree is structurally IDENTICAL to the original (same labels, same
     `wrapped`, same volumes, walks correctly under PreOrderIter). It fails even for a
     single re-imported solid, and calling .mesh() explicitly first does NOT help — so it
     is not a tessellation problem.

  2. `export_gltf` returns True ANYWAY. Its `raise RuntimeError` is commented out upstream,
     and the bool it returns instead is not a reliable success signal either. Checking the
     return value is NOT sufficient; the emitted GLB bytes must be validated.

  3. MITIGATION (verified): rebuild the tree from the imported shapes' raw OCCT handles —
     wrap each child's `.wrapped` in a fresh Solid(), carry `.label` across, assemble a
     fresh Compound. That round-trips correctly AND preserves the per-part names.

Run:  phase-cad/.venv/bin/python phase-cad/probes/probe_step_glb_hierarchy.py
Exits non-zero if the naive path is (still) broken — which, as of 2026-07-14, it is.
"""
import json
import struct
import sys
from pathlib import Path

import tempfile

from build123d import Box, Color, Compound, Cylinder, Location, export_gltf, export_step
from build123d import import_step

# Write artifacts to a temp dir, not the script dir — so a run never litters the repo.
OUT = Path(tempfile.mkdtemp(prefix="cad-hierarchy-probe-"))


def glb_nodes(path: Path):
    """Parse the glTF JSON chunk out of a .glb and return its node names + mesh count."""
    data = path.read_bytes()
    magic, version, _length = struct.unpack("<III", data[:12])
    assert magic == 0x46546C67, "not a GLB"
    chunk_len, chunk_type = struct.unpack("<II", data[12:20])
    assert chunk_type == 0x4E4F534A, "first chunk is not JSON"
    gltf = json.loads(data[20 : 20 + chunk_len])
    return gltf


# --- build a small ASSEMBLY with distinct, named parts (the hero shape in miniature) ---
sun = Cylinder(radius=8, height=6)
sun.label = "sun_gear"
sun.color = Color("goldenrod")

planet = Cylinder(radius=4, height=6)
planet = Location((16, 0, 0)) * planet
planet.label = "planet_gear_1"
planet.color = Color("steelblue")

carrier = Box(40, 8, 3)
carrier = Location((0, 0, -6)) * carrier
carrier.label = "carrier_plate"
carrier.color = Color("dimgray")

asm = Compound(children=[sun, planet, carrier])
asm.label = "planetary_gearset"

print(f"source assembly: {asm.label!r} with {len(asm.children)} children")
for c in asm.children:
    print(f"   - {c.label!r}")

# --- 1. direct export (no STEP hop) — the control ---
direct = OUT / "direct.glb"
ok_direct = export_gltf(asm, str(direct), binary=True)
print(f"\n[control] export_gltf direct -> returned {ok_direct!r}, file={direct.exists()}")
g = glb_nodes(direct)
direct_names = [n.get("name") for n in g.get("nodes", [])]
print(f"[control] GLB nodes: {direct_names}")

# --- 2. the REAL path: export STEP (what the sandboxed tool can do), re-import, -> GLB ---
step = OUT / "asm.step"
export_step(asm, str(step))
print(f"\n[real path] wrote STEP ({step.stat().st_size} bytes)")

reimported = import_step(str(step))
print(f"[real path] re-imported: label={reimported.label!r}, children={len(reimported.children)}")
for c in reimported.children:
    print(f"   - child label: {c.label!r}")

roundtrip = OUT / "roundtrip.glb"
ok_rt = export_gltf(reimported, str(roundtrip), binary=True)
print(f"\n[real path] export_gltf -> returned {ok_rt!r}, file={roundtrip.exists()}")
g2 = glb_nodes(roundtrip)
rt_names = [n.get("name") for n in g2.get("nodes", [])]
print(f"[real path] GLB nodes  : {rt_names}")
print(f"[real path] GLB meshes : {len(g2.get('meshes', []))}")

# --- 3. THE MITIGATION: rebuild the tree from the imported shapes' raw OCCT handles ---
from build123d import Solid  # noqa: E402

rebuilt_kids = []
# `or [reimported]` so a single-root STEP with no child list still rebuilds one part
# rather than an empty Compound (matches smoke_test.py / probe_full_cad_loop.py).
for c in reimported.children or [reimported]:
    part = Solid(c.wrapped)  # fresh build123d object around the same OCCT shape
    part.label = c.label  # carry the name across — the exploded view keys off it
    rebuilt_kids.append(part)
rebuilt = Compound(children=rebuilt_kids)
rebuilt.label = reimported.label

fixed = OUT / "rebuilt.glb"
ok_fix = export_gltf(rebuilt, str(fixed), binary=True)
g3 = glb_nodes(fixed)
fixed_names = [n.get("name") for n in g3.get("nodes", [])]
print(f"\n[mitigation] rebuilt tree -> returned {ok_fix!r}")
print(f"[mitigation] GLB nodes  : {fixed_names}")
print(f"[mitigation] GLB meshes : {len(g3.get('meshes', []))}")

# --- verdict ---
want = {"sun_gear", "planet_gear_1", "carrier_plate"}
naive_got = {n for n in rt_names if n}
fixed_got = {n for n in fixed_names if n}

print("\n" + "=" * 64)
print(f"NAIVE round-trip  : {len(g2.get('meshes', []))} meshes, names {naive_got or 'NONE'}")
print(f"REBUILT tree      : {len(g3.get('meshes', []))} meshes, names {fixed_got or 'NONE'}")
print(f"export_gltf returned {ok_rt!r} for the EMPTY one — the return value cannot be trusted")

naive_broken = not (want <= naive_got)
fix_works = want <= fixed_got and len(g3.get("meshes", [])) >= 3

if fix_works and naive_broken:
    print("\nVERDICT: NJ-18 REPRODUCED. Naive STEP->GLB silently emits an empty model;")
    print("         rebuilding the tree fixes it and preserves the per-part names.")
    sys.exit(1)  # non-zero: the upstream bug is still present
if fix_works and not naive_broken:
    print("\nVERDICT: upstream appears FIXED — the naive round-trip now works too.")
    print("         Re-check NJ-18; the converter's rebuild step may no longer be needed.")
    sys.exit(0)
print("\nVERDICT: FAIL — even the rebuilt tree lost the hierarchy. Do not ship the viewer.")
sys.exit(2)
