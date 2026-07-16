// The LAB hub's disciplines (Lab.md §1–§3). LAB is a *launcher*: picking a card enters
// that lab's workspace, which reuses the shared shell (LabShell). Only Mechanical is wired
// live in this first PR — it reuses the existing CAD agent/viewer, so it's a re-layout, not
// a rebuild. Bio and Chem are shown as "coming soon" so their cards are honest, visible
// placeholders rather than dead buttons (CLAUDE.md rule 8 — degrade with a visible fallback).
export type LabId = "mechanical" | "bio" | "chem"

export interface LabDef {
  id: LabId
  label: string
  emoji: string
  blurb: string
  status: "live" | "soon"
}

export const LABS: LabDef[] = [
  { id: "mechanical", label: "Mechanical & Physics", emoji: "🚪", blurb: "CAD, physics & simulation — build and inspect 3D parts.", status: "live" },
  { id: "bio", label: "Bio Lab", emoji: "🧬", blurb: "Proteins, genes, pathways — molecular & synthetic biology.", status: "soon" },
  { id: "chem", label: "Chem Lab", emoji: "⚗", blurb: "Molecules, reactions & simulation.", status: "soon" },
]

// Non-null: every id comes from LABS, so a missing entry would be a programmer error.
export function labById(id: LabId): LabDef {
  return LABS.find((l) => l.id === id)!
}
