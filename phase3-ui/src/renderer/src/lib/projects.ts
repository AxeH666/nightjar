import { useCallback, useEffect, useRef, useState } from "react"
import type { LabId } from "../components/lab/labs"
import { deleteProjectContent, copyProjectContent } from "./projectContent"

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

// The storage side of duplicate(), extracted from the hook so its FAILURE ORDERING is testable
// without a React renderer — the two orderings fail differently and both leak if unhandled:
//   1. content copy fails            → copyProjectContent rolls back its own partial writes
//   2. content copies, list write fails → the content must be removed here, or storage keeps
//      Memory/Instructions/Files under an id that appears in no list. That is orphaned forever,
//      because only remove() ever deletes content and it cannot reach an id it cannot see.
// Returns whether the duplicate fully landed; on ANY failure storage is left as it was found.
export function persistDuplicate(srcId: string, copyId: string, writeList: () => boolean): boolean {
  if (!copyProjectContent(srcId, copyId)) return false
  if (!writeList()) {
    // Best-effort cleanup: the copied content is removed so it doesn't orphan under an id no
    // list references. If THIS delete also fails (storage still broken), the content lingers —
    // there is no clean recovery for a failure during the cleanup of a failure without a
    // transactional store. That residual is tracked under NJ-41 (Bugbot).
    deleteProjectContent(copyId)
    return false
  }
  return true
}

// A collision-resistant id (renderer Date.now() is fine — only workflow scripts forbid it).
let seq = 0
function newId(): string {
  seq += 1
  return `p_${Date.now().toString(36)}_${seq}`
}

export interface ProjectsStore {
  projects: Project[]
  // Returns the new project AND whether it actually persisted. Callers must NOT navigate into
  // a project whose `persisted` is false — it exists only in this hook's memory, and the
  // destination view mounts its own store from disk and would not find it (NJ-41).
  create: (name: string, description?: string) => { project: Project; persisted: boolean }
  rename: (id: string, name: string) => void
  setDescription: (id: string, description: string) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  toggleFavorite: (id: string) => void
  get: (id: string) => Project | undefined
}

export function useProjects(scope: ProjectScope): ProjectsStore {
  const [projects, setProjects] = useState<Project[]>(() => loadProjects(scope))
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
  // Returns whether the list actually persisted, which create/duplicate use to decide whether
  // to keep or revert the in-memory change.
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

  // Restore the in-memory list to a snapshot after a failed persist, so a create/duplicate that
  // didn't survive to disk doesn't leave a clickable card behind. That card is the real hazard:
  // ProjectView mounts its OWN useProjects loaded from disk, so it could never find such a
  // project (NJ-41) — the user would open an empty, un-renameable shell. Reverting removes it.
  const revertTo = useCallback((snapshot: Project[]) => {
    projectsRef.current = snapshot
    setProjects(snapshot)
  }, [])

  const create = useCallback(
    (name: string, description?: string): { project: Project; persisted: boolean } => {
      const before = projectsRef.current
      const now = Date.now()
      const p: Project = { id: newId(), name: name.trim() || "Untitled project", description, favorite: false, createdAt: now, updatedAt: now }
      const persisted = mutate((prev) => [p, ...prev])
      if (!persisted) revertTo(before) // don't leave an unpersisted card the caller might navigate into
      return { project: p, persisted }
    },
    [mutate, revertTo],
  )
  const rename = useCallback(
    (id: string, name: string) => {
      mutate((prev) => prev.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() } : p)))
    },
    [mutate],
  )
  const setDescription = useCallback(
    (id: string, description: string) => {
      mutate((prev) => prev.map((p) => (p.id === id ? { ...p, description, updatedAt: Date.now() } : p)))
    },
    [mutate],
  )
  const remove = useCallback(
    (id: string) => {
      // Drop the project's Memory/Instructions/Files too — must not linger on disk. If that
      // fails we still remove the card: the user asked for the project to go, and leaving it
      // would be a worse failure than the content residue.
      deleteProjectContent(id)
      mutate((prev) => prev.filter((p) => p.id !== id))
    },
    [mutate],
  )
  const duplicate = useCallback(
    (id: string) => {
      const src = projectsRef.current.find((p) => p.id === id)
      if (!src) return
      const before = projectsRef.current
      const now = Date.now()
      const copy: Project = { ...src, id: newId(), name: `${src.name} (copy)`, favorite: false, createdAt: now, updatedAt: now }
      // Content is copied FIRST: a duplicate whose Memory/Instructions/Files silently didn't
      // come across is not a duplicate, it is an empty project wearing the source's name — and
      // the projects-list write is small enough that it would usually succeed even when the
      // content copy hit quota, leaving the card looking perfectly correct. persistDuplicate
      // rolls its own writes back on failure; here we also revert the in-memory insert so the
      // user isn't left holding a duplicate that is empty now and gone after a reload.
      const ok = persistDuplicate(src.id, copy.id, () => mutate((prev) => [copy, ...prev]))
      if (!ok && projectsRef.current !== before) revertTo(before)
    },
    [mutate, revertTo],
  )
  const toggleFavorite = useCallback(
    (id: string) => {
      mutate((prev) => prev.map((p) => (p.id === id ? { ...p, favorite: !p.favorite, updatedAt: Date.now() } : p)))
    },
    [mutate],
  )
  const get = useCallback((id: string) => projectsRef.current.find((p) => p.id === id), [])

  return { projects, create, rename, setDescription, remove, duplicate, toggleFavorite, get }
}
