#!/usr/bin/env python
"""Trusted STEP -> GLB converter for Nightjar's CAD viewer (Task 5).

Runs OUTSIDE the build123d-mcp sandbox (it's Nightjar's own code, not model-authored):
the model can only emit STEP via the sandboxed `export` tool — build123d-mcp has no GLB
export — so this converts the STEP it produced into a GLB the three.js viewer loads.

Two upstream footguns this MUST defend against (see KNOWN_ISSUES NJ-18, verified by
phase-cad/probes/):
  1. `import_step`'s tree exports an EMPTY glb even though it looks identical to the
     original. Fix: REBUILD each leaf from its raw OCCT handle (fresh Solid(child.wrapped)),
     carrying the .label, into a fresh Compound. That preserves the per-part NAMES the
     exploded view keys off.
  2. `export_gltf` returns True even when it writes an empty file. Its return value is NOT
     a reliable success signal — so we VALIDATE the emitted GLB bytes (nodes > 0, meshes > 0)
     and exit non-zero if the model came out empty.

CLI:   step_to_glb.py <input.step> <output.glb>
Print: a single JSON line to stdout — {"ok": true, "parts": [...], "nodes": N, "meshes": M}
       on success, or {"ok": false, "error": "..."} on failure (also exit non-zero).
The Electron main process calls this via execFile under a wall-clock timeout (rule 3).
"""
import json
import struct
import sys
from pathlib import Path

GLB_MAGIC = 0x46546C67


def _validate_glb(path: Path) -> tuple[list[str], int]:
    """Parse the glTF JSON chunk; return (node names, mesh count). Raise if not a real GLB."""
    data = path.read_bytes()
    if len(data) < 20 or struct.unpack("<I", data[:4])[0] != GLB_MAGIC:
        raise RuntimeError("output is not a valid GLB (bad magic / too short)")
    chunk_len, chunk_type = struct.unpack("<II", data[12:20])
    if chunk_type != 0x4E4F534A:  # 'JSON'
        raise RuntimeError("first GLB chunk is not JSON")
    gltf = json.loads(data[20 : 20 + chunk_len])
    names = [n.get("name") for n in gltf.get("nodes", [])]
    return names, len(gltf.get("meshes", []))


def convert(step_path: str, glb_path: str) -> dict:
    from build123d import Compound, Solid, export_gltf, import_step

    src = Path(step_path)
    if not src.is_file() or src.stat().st_size == 0:
        raise RuntimeError(f"input STEP missing or empty: {step_path}")

    imported = import_step(step_path)

    # (1) Rebuild the tree from raw OCCT handles, carrying labels. `or [imported]` handles a
    # single-root STEP with no child list (else an empty Compound → empty GLB).
    kids = []
    for child in imported.children or [imported]:
        if child.wrapped is None:
            continue
        part = Solid(child.wrapped)
        if child.label:
            part.label = child.label
        kids.append(part)
    if not kids:
        raise RuntimeError("STEP contained no solid geometry to convert")
    rebuilt = Compound(children=kids)
    rebuilt.label = imported.label or "assembly"

    # (2) Export, then VALIDATE the bytes — export_gltf's return value is not trustworthy.
    returned = export_gltf(rebuilt, glb_path, binary=True)
    names, meshes = _validate_glb(Path(glb_path))
    part_names = [n for n in names if n]
    if meshes == 0 or not part_names:
        raise RuntimeError(
            f"export_gltf returned {returned!r} but wrote an EMPTY model "
            f"(nodes={names}, meshes={meshes}) — the STEP->GLB rebuild failed"
        )
    return {"ok": True, "parts": part_names, "nodes": len(names), "meshes": meshes, "glb": glb_path}


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(json.dumps({"ok": False, "error": "usage: step_to_glb.py <input.step> <output.glb>"}))
        return 2
    try:
        print(json.dumps(convert(argv[1], argv[2])))
        return 0
    except Exception as exc:  # noqa: BLE001 — the Electron caller reads {ok:false,error}
        print(json.dumps({"ok": False, "error": f"{exc.__class__.__name__}: {exc}"}))
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
