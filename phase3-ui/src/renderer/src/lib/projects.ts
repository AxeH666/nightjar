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
function persistProjects(scope: ProjectScope, projects: Project[]): void {
  try {
    localStorage.setItem(projectsKey(scope), JSON.stringify(projects))
  } catch {
    /* localStorage unavailable → this run keeps projects in memory only */
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
}

export function useProjects(scope: ProjectScope): ProjectsStore {
  const [projects, setProjects] = useState<Project[]>(() => loadProjects(scope))
  // The ref is the authoritative current list, updated SYNCHRONOUSLY by every mutation; state
  // mirrors it for rendering.
  const projectsRef = useRef(projects)

  // Each scope (lab or the general space) has its own list — reload when the scope changes.
  useEffect(() => {
    const loaded = loadProjects(scope)
    projectsRef.current = loaded
    setProjects(loaded)
  }, [scope])

  // Persist SYNCHRONOUSLY from the ref, so a mutation survives even when this component
  // unmounts in the same React batch — e.g. "create → immediately open the project" navigates
  // away and unmounts Projects home before a setState-scheduled persist could ever run.
  const mutate = useCallback(
    (fn: (prev: Project[]) => Project[]) => {
      const next = fn(projectsRef.current)
      projectsRef.current = next
      persistProjects(scope, next)
      setProjects(next)
    },
    [scope],
  )

  const create = useCallback(
    (name: string, description?: string): Project => {
      const now = Date.now()
      const p: Project = { id: newId(), name: name.trim() || "Untitled project", description, favorite: false, createdAt: now, updatedAt: now }
      mutate((prev) => [p, ...prev])
      return p
    },
    [mutate],
  )
  const rename = useCallback(
    (id: string, name: string) => mutate((prev) => prev.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() } : p))),
    [mutate],
  )
  const setDescription = useCallback(
    (id: string, description: string) => mutate((prev) => prev.map((p) => (p.id === id ? { ...p, description, updatedAt: Date.now() } : p))),
    [mutate],
  )
  const remove = useCallback(
    (id: string) => {
      deleteProjectContent(id) // drop the project's Memory/Instructions/Files too — must not linger on disk
      mutate((prev) => prev.filter((p) => p.id !== id))
    },
    [mutate],
  )
  const duplicate = useCallback(
    (id: string) => {
      const src = projectsRef.current.find((p) => p.id === id)
      if (!src) return
      const now = Date.now()
      const copy: Project = { ...src, id: newId(), name: `${src.name} (copy)`, favorite: false, createdAt: now, updatedAt: now }
      copyProjectContent(src.id, copy.id) // carry Memory/Instructions/Files into the duplicate
      mutate((prev) => [copy, ...prev])
    },
    [mutate],
  )
  const toggleFavorite = useCallback(
    (id: string) => mutate((prev) => prev.map((p) => (p.id === id ? { ...p, favorite: !p.favorite, updatedAt: Date.now() } : p))),
    [mutate],
  )
  const get = useCallback((id: string) => projectsRef.current.find((p) => p.id === id), [])

  return { projects, create, rename, setDescription, remove, duplicate, toggleFavorite, get }
}
