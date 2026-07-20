import { useState } from "react"
import { ProjectsHome } from "../components/lab/ProjectsHome"
import { ProjectView } from "../components/lab/ProjectView"

// The top-level Projects tab: a GENERAL (non-lab) project space — a global work container like the
// reference product's Projects, kept separate from the per-lab CAD projects. Reuses ProjectsHome
// (card grid, New project, search/sort, rename/duplicate/delete) + ProjectView (Instructions /
// Memory / Files). No back button on the home — it IS a top-level tab. Per-project chat isolation
// stays the 5b stub (ProjectView discloses this in-UI).
export function ProjectsScreen() {
  const [openId, setOpenId] = useState<string | null>(null)
  return openId ? (
    <ProjectView scope="general" projectId={openId} onBack={() => setOpenId(null)} />
  ) : (
    <ProjectsHome scope="general" onOpen={setOpenId} />
  )
}
