"""Static material-property table + tier-1 feasibility checks for Prompt-to-CAD (Task 5).

No FEA/CFD in v1. This is the conversational-sanity-check layer: a small curated table
(density + yield strength) plus pure numeric checks over what `measure` already returns
(volume → mass, bounding box → thinness). The CAD agent reasons with this to say things like
"a beeswax wing can't bear load" — the LLM does the judgement, this supplies the numbers.

Deliberately NOT pymat-mcp (alpha, 7-star, single-maintainer): ~15 constants don't warrant a
dependency on the critical path. Density is g/cm³ (so mass_g = volume_mm3 * density / 1000,
matching build123d-mcp's measure), yield strength is MPa.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Material:
    key: str
    name: str
    density_g_cm3: float
    yield_mpa: float  # approximate; 0 for materials with no meaningful load rating
    note: str


# ~15 common materials. Values are representative textbook figures, not a certified datasheet.
MATERIALS: dict[str, Material] = {
    m.key: m
    for m in [
        Material("abs", "ABS plastic", 1.05, 40, "common FDM 3D-print plastic"),
        Material("pla", "PLA plastic", 1.24, 50, "stiff but brittle print plastic"),
        Material("petg", "PETG plastic", 1.27, 50, "tougher print plastic"),
        Material("nylon", "Nylon (PA12)", 1.01, 45, "tough, flexible, low-friction"),
        Material("delrin", "Delrin (POM)", 1.41, 65, "stiff, low-friction, machinable"),
        Material("acrylic", "Acrylic (PMMA)", 1.18, 70, "clear, brittle"),
        Material("aluminum", "Aluminium 6061", 2.70, 276, "light structural metal"),
        Material("steel", "Steel (mild)", 7.85, 250, "strong, heavy, cheap"),
        Material("stainless", "Stainless 304", 8.00, 215, "corrosion-resistant steel"),
        Material("titanium", "Titanium Ti-6Al-4V", 4.43, 880, "strong + light, expensive"),
        Material("brass", "Brass", 8.50, 200, "machinable, decorative"),
        Material("copper", "Copper", 8.96, 70, "conductive, soft"),
        Material("pine", "Pine wood", 0.50, 40, "light softwood (grain-dependent)"),
        Material("oak", "Oak wood", 0.75, 50, "dense hardwood"),
        Material("beeswax", "Beeswax", 0.96, 0.5, "very soft — decorative only, no load"),
        Material("rubber", "Rubber", 1.20, 15, "elastic — deforms under load"),
    ]
}

# Thinness thresholds (mm) below which a part is likely too fragile to print/machine.
THIN_WALL_WARN_MM = 1.0
THIN_WALL_INFO_MM = 2.0


def feasibility_report(volume_mm3: float, min_dim_mm: float, material_key: str) -> dict:
    """Tier-1 feasibility for a part. Returns mass + a list of plain-language warnings.

    `min_dim_mm` is the smallest bounding-box dimension (a cheap proxy for the thinnest
    feature — a real wall-thickness needs more, but this catches obviously-fragile parts).
    Unknown material → a warning + no mass (we won't invent a density).
    """
    warnings: list[str] = []
    mat = MATERIALS.get(material_key.lower().strip())

    mass_g = None
    if mat is None:
        warnings.append(
            f"Unknown material '{material_key}'. Known: {', '.join(sorted(MATERIALS))}."
        )
    else:
        mass_g = round(volume_mm3 * mat.density_g_cm3 / 1000, 2)
        if mat.yield_mpa <= 1:
            warnings.append(
                f"{mat.name} has almost no load-bearing strength ({mat.yield_mpa} MPa) — "
                f"decorative use only, it can't carry force."
            )
        elif mat.yield_mpa < 20:
            warnings.append(f"{mat.name} is soft ({mat.yield_mpa} MPa) — it will flex or deform under load.")

    if min_dim_mm < THIN_WALL_WARN_MM:
        warnings.append(
            f"Thinnest dimension is {min_dim_mm:.2f} mm — likely too fragile to print or machine reliably."
        )
    elif min_dim_mm < THIN_WALL_INFO_MM:
        warnings.append(f"Thinnest dimension is {min_dim_mm:.2f} mm — printable but delicate.")

    return {"material": mat.name if mat else None, "mass_g": mass_g, "warnings": warnings}


def prompt_table() -> str:
    """A compact one-line-per-material block for the CAD agent's system prompt."""
    return "\n".join(
        f"- {m.name}: density {m.density_g_cm3} g/cm³, yield {m.yield_mpa} MPa ({m.note})"
        for m in MATERIALS.values()
    )


if __name__ == "__main__":
    import sys

    fails = []

    def check(name, cond):
        print(f"{'PASS' if cond else 'FAIL'}: {name}")
        if not cond:
            fails.append(name)

    # steel bracket, 1206 mm³ → 1206 * 7.85 / 1000 = 9.47 g
    r = feasibility_report(1206.0, 5.0, "steel")
    check("steel mass ≈ 9.47 g", abs(r["mass_g"] - 9.47) < 0.05)
    check("steel: no warnings for a chunky part", r["warnings"] == [])

    # beeswax: no load
    r = feasibility_report(1000.0, 5.0, "beeswax")
    check("beeswax flags no-load", any("decorative" in w for w in r["warnings"]))

    # thin part
    r = feasibility_report(500.0, 0.4, "pla")
    check("0.4mm flagged too fragile", any("fragile" in w for w in r["warnings"]))

    # unknown material
    r = feasibility_report(500.0, 5.0, "unobtainium")
    check("unknown material → warning + no mass", r["mass_g"] is None and any("Unknown" in w for w in r["warnings"]))

    check("prompt_table lists all 16 materials", prompt_table().count("\n") == len(MATERIALS) - 1)

    print(f"\n{len(MATERIALS)} materials, {len(fails) == 0 and 'all checks passed' or f'{len(fails)} FAILED'}")
    sys.exit(1 if fails else 0)
