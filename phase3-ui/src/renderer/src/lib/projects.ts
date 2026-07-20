import { useCallback, useEffect, useRef, useState } from "react"
import type { LabId } from "../components/lab/labs"
import { deleteProjectContent, copyProjectContent } from "./projectContent"
import { reportStorageWrite, useStorageHealthy } from "./storageHealth"

// A project space. The science labs (mechanical/bio/chem) each keep their own list; "general" is
// the top-level, non-lab Projects space surfaced in the main nav — a global work container, like
// the reference product's Projects. Per-project chat isolation is layered on in the 5b PR.
export type ProjectScope = LabId | "general"

// Per-lab Projects (Lab.md §4.6): a project is an isolated container so related work stays
// separate ("openforge" and "manohiti" never bleed together). This module is the STORE —
// the Project record + localStorage-backed CRUD, scoped per lab. Per-project isolation of
// chats + Memory/Instructions/Files is layered on in the next PR. localStorage is
// renderer-only and can be blocked, so every access is guarded and degrades to in-memory.
export interface Project {
  id: string
  name: string
  description?: string
  favorite: boolean
  createdAt: number
  updatedAt: number
}

function projectsKey(scope: ProjectScope): string {
  return `nightjar.projects.${scope}`
}
function loadProjects(scope: ProjectScope): Project[] {
  try {
    const raw = localStorage.getItem(projectsKey(scope))
    return raw ? (JSON.parse(raw) as Project[]) : []
  } catch {
    return []
  }
}
// Returns whether the write actually landed, so a failed create/rename/delete can be shown
// rather than silently presenting a fully successful-looking UI over nothing (see the
// SaveResult note in projectContent.ts — same reasoning, same hazard).
export function persistProjects(scope: ProjectScope, projects: Project[]): boolean {
  try {
    localStorage.setItem(projectsKey(scope), JSON.stringify(projects))
    return true
  } catch {
    return false // quota exceeded or storage blocked → this run keeps projects in memory only
  }
}

// A collision-resistant id (renderer Date.now() is fine — only workflow scripts forbid it).
let seq = 0
function newId(): string {
  seq += 1
  return `p_${Date.now().toString(36)}_${seq}`
}

export interface ProjectsStore {
  projects: Project[]
  create: (name: string, description?: string) => Project
  rename: (id: string, name: string) => void
  setDescription: (id: string, description: string) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  toggleFavorite: (id: string) => void
  get: (id: string) => Project | undefined
  // False once any mutation has failed to persist. The list still renders (we keep the
  // in-memory copy so the session stays usable), but the UI must say the changes aren't
  // being saved rather than let them look durable.
  storageOk: boolean
}

export function useProjects(scope: ProjectScope): ProjectsStore {
  const [projects, setProjects] = useState<Project[]>(() => loadProjects(scope))
  // Module-level, NOT component state: this hook is remounted by ordinary navigation, and a
  // per-component flag would reset the "changes aren't saving" warning to healthy on every
  // remount while storage was still broken. See storageHealth.ts.
  const storageOk = useStorageHealthy()
  // The ref is the authoritative current list, updated SYNCHRONOUSLY by every mutation; state
  // mirrors it for rendering.
  const projectsRef = useRef(projects)

  // Each scope (lab or the general space) has its own list — reload when the scope changes.
  // Storage health is deliberately NOT reset here: it is a property of the origin, not of a
  // scope, so switching labs must not clear a live warning.
  useEffect(() => {
    const loaded = loadProjects(scope)
    projectsRef.current = loaded
    setProjects(loaded)
  }, [scope])

  // Persist SYNCHRONOUSLY from the ref, so a mutation survives even when this component
  // unmounts in the same React batch — e.g. "create → immediately open the project" navigates
  // away and unmounts Projects home before a setState-scheduled persist could ever run.
  // Returns whether the list actually persisted. It deliberately does NOT report storage health
  // itself: an operation can perform several writes (duplicate copies content AND writes the
  // list), and reporting each one separately lets a later small success clear the flag a larger
  // failure just set — masking exactly the case this is meant to catch. So every operation
  // below reports ONCE, combining every write it made. (Bugbot, PR #125.)
  const mutate = useCallback(
    (fn: (prev: Project[]) => Project[]): boolean => {
      const next = fn(projectsRef.current)
      projectsRef.current = next
      const ok = persistProjects(scope, next)
      setProjects(next)
      return ok
    },
    [scope],
  )

  const create = useCallback(
    (name: string, description?: string): Project => {
      const now = Date.now()
      const p: Project = { id: newId(), name: name.trim() || "Untitled project", description, favorite: false, createdAt: now, updatedAt: now }
      reportStorageWrite(mutate((prev) => [p, ...prev]))
      return p
    },
    [mutate],
  )
  const rename = useCallback(
    (id: string, name: string) => {
      reportStorageWrite(mutate((prev) => prev.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() } : p))))
    },
    [mutate],
  )
  const setDescription = useCallback(
    (id: string, description: string) => {
      reportStorageWrite(mutate((prev) => prev.map((p) => (p.id === id ? { ...p, description, updatedAt: Date.now() } : p))))
    },
    [mutate],
  )
  const remove = useCallback(
    (id: string) => {
      // Drop the project's Memory/Instructions/Files too — must not linger on disk. If that
      // fails we still remove the card: the user asked for the project to go, and leaving it
      // would be a worse failure than the content residue. Both results are combined into ONE
      // health report so a successful list write can't mask the failed content delete.
      const contentOk = deleteProjectContent(id)
      const listOk = mutate((prev) => prev.filter((p) => p.id !== id))
      reportStorageWrite(contentOk && listOk)
    },
    [mutate],
  )
  const duplicate = useCallback(
    (id: string) => {
      const src = projectsRef.current.find((p) => p.id === id)
      if (!src) return
      const now = Date.now()
      const copy: Project = { ...src, id: newId(), name: `${src.name} (copy)`, favorite: false, createdAt: now, updatedAt: now }
      // Copy content FIRST and abort if it fails. A duplicate whose Memory/Instructions/Files
      // silently didn't come across is not a duplicate — it is an empty project wearing the
      // source's name, and the projects-list write is small enough that it would usually
      // succeed even when the content copy hit quota, leaving the card looking correct.
      // copyProjectContent rolls back its partial writes, so aborting orphans nothing.
      if (!copyProjectContent(src.id, copy.id)) {
        reportStorageWrite(false)
        return
      }
      reportStorageWrite(mutate((prev) => [copy, ...prev]))
    },
    [mutate],
  )
  const toggleFavorite = useCallback(
    (id: string) => {
      reportStorageWrite(mutate((prev) => prev.map((p) => (p.id === id ? { ...p, favorite: !p.favorite, updatedAt: Date.now() } : p))))
    },
    [mutate],
  )
  const get = useCallback((id: string) => projectsRef.current.find((p) => p.id === id), [])

  return { projects, create, rename, setDescription, remove, duplicate, toggleFavorite, get, storageOk }
}
