import { useState } from "react"
import { ProjectsHome } from "../components/lab/ProjectsHome"
import { ProjectView } from "../components/lab/ProjectView"

// The top-level Projects tab: a GENERAL (non-lab) project space — a global work container like the
// reference product's Projects, kept separate from the per-lab CAD projects. Reuses ProjectsHome
// (card grid, New project, search/sort, rename/duplicate/delete) + ProjectView (an isolated Chat +
// Instructions / Memory / Files). No back button on the home — it IS a top-level tab. 5b: each
// project's Chat is bound to its own OpenCode session; gated Instructions injection is PR-C.
export function ProjectsScreen() {
  const [openId, setOpenId] = useState<string | null>(null)
  return openId ? (
    <ProjectView scope="general" projectId={openId} onBack={() => setOpenId(null)} />
  ) : (
    <ProjectsHome scope="general" onOpen={setOpenId} />
  )
}
