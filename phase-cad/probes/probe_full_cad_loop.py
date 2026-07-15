"""End-to-end Task-5 pipeline probe, headless:

  execute (build123d in the mcp sandbox) -> measure -> export('*', step)
  -> trusted STEP->GLB converter (rebuild tree + validate bytes)
  -> assert GLB has one named node per part.

Drives the REAL build123d_mcp server tool functions (execute/measure/export), the
same code path an MCP client hits — so a pass means the whole Task-5 core works.

Requires the phase-cad env AND BUILD123D_IN_PROCESS=1 (the default worker-subprocess
mode fails under sandboxed hosts, upstream #143):

  BUILD123D_IN_PROCESS=1 phase-cad/.venv/bin/python phase-cad/probes/probe_full_cad_loop.py
"""
import json
import struct
import sys
import tempfile
from pathlib import Path

OUT = Path(tempfile.mkdtemp(prefix="cad-probe-"))

import build123d_mcp.server as srv  # noqa: E402
from build123d_mcp.worker import WorkerSession  # noqa: E402

# Bootstrap the module-level session the stdio server would create at startup.

if __name__ == "__main__":
    srv.configure(WorkerSession())

    # A miniature planetary-ish assembly: two named parts registered with show().
    import textwrap

    CODE = textwrap.dedent(
        """
        from build123d import *
        sun = Cylinder(radius=8, height=6)
        show(sun, "sun_gear")
        planet = Pos(16, 0, 0) * Cylinder(radius=4, height=6)
        show(planet, "planet_gear_1")
        """
    )

    print("=== execute ===")
    r = srv.execute(CODE)
    print(r[:300])

    print("\n=== measure (sun_gear, steel density) ===")
    m = srv.measure(object_name="sun_gear", density=0.00785)
    print(m[:300])

    step_path = str(OUT / "assembly_from_mcp.step")
    print("\n=== export('*', step) ===")
    e = srv.export(step_path, "step", "*")
    print(e[:300])
    assert Path(step_path).exists() and Path(step_path).stat().st_size > 0, "STEP not written"

    # --- trusted STEP -> GLB converter (NJ-18 mitigation: rebuild tree, validate bytes) ---
    print("\n=== STEP -> GLB (rebuild + validate) ===")
    from build123d import Compound, Solid, export_gltf, import_step  # noqa: E402


    def step_to_glb(step_file: str, glb_file: str) -> dict:
        imported = import_step(step_file)
        # Rebuild every leaf from its raw OCCT handle, carrying the label (NJ-18: the
        # import_step tree itself exports an EMPTY glb).
        kids = []
        for child in imported.children if imported.children else [imported]:
            part = Solid(child.wrapped)
            part.label = child.label
            kids.append(part)
        rebuilt = Compound(children=kids)
        rebuilt.label = imported.label or "assembly"
        ok = export_gltf(rebuilt, glb_file, binary=True)  # return value is NOT trustworthy
        # Validate the actual bytes.
        data = Path(glb_file).read_bytes()
        if len(data) < 20 or struct.unpack("<I", data[:4])[0] != 0x46546C67:
            raise RuntimeError("not a GLB")
        clen, ctype = struct.unpack("<II", data[12:20])
        gltf = json.loads(data[20 : 20 + clen])
        names = [n.get("name") for n in gltf.get("nodes", [])]
        meshes = len(gltf.get("meshes", []))
        if not names or meshes == 0:
            raise RuntimeError(f"export_gltf returned {ok!r} but wrote an EMPTY glb ({names=}, {meshes=})")
        return {"names": names, "meshes": meshes, "returned": ok}


    glb_path = str(OUT / "assembly_from_mcp.glb")
    res = step_to_glb(step_path, glb_path)
    print("GLB names :", res["names"])
    print("GLB meshes:", res["meshes"])

    want = {"sun_gear", "planet_gear_1"}
    got = {n for n in res["names"] if n}
    ok = want <= got and res["meshes"] >= 2
    print("\n" + "=" * 60)
    print(f"VERDICT: {'PASS — mcp execute→measure→export(step)→GLB round-trips with per-part names' if ok else 'FAIL'}")
    print(f"  part names preserved: {want & got or 'NONE'}   (wanted {want})")
    sys.exit(0 if ok else 1)
