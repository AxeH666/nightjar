"""Pre-authored 'hero' assembly for the Prompt-to-CAD demo (Task 5): a planetary gearset.

Open prompting is reserved for bounded single parts; the hero is pre-authored so it always
explodes convincingly. 5 named parts (sun / 3 planets / ring / carrier = 6), each registered
with show(name) so the STEP export carries the names into the GLB nodes the viewer keys off.

Involute teeth are overkill for a viewer demo, so gears are represented as toothed-looking
cylinders (a hub + a ring of small cylindrical "teeth") — reads clearly as a gear when
exploded, stays cheap to tessellate. This runs as build123d-mcp `execute` code (sandbox-safe:
only build123d + math), or standalone in the phase-cad venv.
"""
from math import cos, pi, sin

from build123d import Cylinder, Pos, Compound, Rot


def _gear(radius: float, height: float, n_teeth: int, tooth_r: float):
    """A hub cylinder with a ring of small cylinders around it — a gear-looking part."""
    body = Cylinder(radius=radius, height=height)
    teeth = []
    for i in range(n_teeth):
        a = 2 * pi * i / n_teeth
        teeth.append(Pos(radius * cos(a), radius * sin(a), 0) * Cylinder(radius=tooth_r, height=height))
    g = body
    for t in teeth:
        g = g + t
    return g


def build():
    """Return (named_parts, assembly) — a list of labelled parts and the Compound."""
    parts = []

    sun = _gear(radius=8, height=8, n_teeth=12, tooth_r=1.6)
    sun.label = "sun_gear"
    parts.append(sun)

    # 3 planets on a 22mm orbit, 120° apart.
    orbit = 22.0
    for i in range(3):
        a = 2 * pi * i / 3
        p = Pos(orbit * cos(a), orbit * sin(a), 0) * _gear(radius=5, height=8, n_teeth=9, tooth_r=1.3)
        p.label = f"planet_{i + 1}"
        parts.append(p)

    # Ring gear: an annulus (outer cylinder minus a bore) with inward teeth omitted for clarity.
    ring_outer = Cylinder(radius=40, height=8)
    ring_bore = Cylinder(radius=34, height=9)
    ring = ring_outer - ring_bore
    ring.label = "ring_gear"
    parts.append(ring)

    # Carrier plate below, with three pins the planets ride on.
    carrier = Pos(0, 0, -7) * Cylinder(radius=30, height=3)
    for i in range(3):
        a = 2 * pi * i / 3
        carrier = carrier + Pos(orbit * cos(a), orbit * sin(a), -3) * Cylinder(radius=2, height=6)
    carrier.label = "carrier"
    parts.append(carrier)

    asm = Compound(children=parts)
    asm.label = "planetary_gearset"
    return parts, asm


# When run as build123d-mcp execute() code, register each part with show() so the export
# ('*', step) carries the names. `show` is injected into the sandbox namespace; guard it so
# this file also runs standalone (where show doesn't exist).
def register(show):
    parts, _ = build()
    for p in parts:
        show(p, p.label)
    return [p.label for p in parts]


if __name__ == "__main__":
    # Build + export the hero to a STEP. With `--export <path>` writes there (the app's
    # "Load demo" path drives this); with no args writes to a temp dir and prints a report
    # (a standalone check that the hero is a clean, non-degenerate assembly).
    import sys
    import tempfile
    from pathlib import Path
    from build123d import export_step

    args = sys.argv[1:]
    out = Path(args[1]) if len(args) == 2 and args[0] == "--export" else (
        Path(tempfile.mkdtemp(prefix="hero-")) / "planetary_gearset.step"
    )
    _, asm = build()
    export_step(asm, str(out))
    n_parts = len(asm.children)
    ok = n_parts >= 4 and out.stat().st_size > 0
    if args[:1] != ["--export"]:
        print(f"hero built: {n_parts} named parts, {len(asm.solids())} solids, volume {asm.volume:.0f} mm³")
        print(f"STEP: {out} ({out.stat().st_size} bytes)")
    sys.exit(0 if ok else 1)
