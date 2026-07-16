import { useCallback, useEffect, useRef, useState } from "react"

// Per-project content (Lab.md §4.6): Memory, Instructions, and Files, each scoped to ONE
// project and persisted in localStorage. This is the data layer + it powers the editable
// panels in ProjectView. Wiring Instructions into the lab agent's prompt and isolating a
// project's chats are a deliberate follow-up — they need live session-lifecycle work +
// on-device verification (CLAUDE.md rules 6/8), whereas this storage + UI is verifiable
// headlessly. localStorage is renderer-only and guarded; it degrades to in-memory only.
export interface ProjectFile {
  id: string
  name: string
  content: string
}

export interface ProjectContent {
  instructions: string
  setInstructions: (v: string) => void
  memory: string
  setMemory: (v: string) => void
  files: ProjectFile[]
  addFile: (name: string, content: string) => void
  removeFile: (id: string) => void
}

function key(projectId: string, part: string): string {
  return `nightjar.project.${projectId}.${part}`
}
function loadStr(projectId: string, part: string): string {
  try {
    return localStorage.getItem(key(projectId, part)) ?? ""
  } catch {
    return ""
  }
}
function saveStr(projectId: string, part: string, v: string): void {
  try {
    localStorage.setItem(key(projectId, part), v)
  } catch {
    /* localStorage unavailable → in-memory only for this run */
  }
}
function loadFiles(projectId: string): ProjectFile[] {
  try {
    const raw = localStorage.getItem(key(projectId, "files"))
    return raw ? (JSON.parse(raw) as ProjectFile[]) : []
  } catch {
    return []
  }
}
function saveFiles(projectId: string, files: ProjectFile[]): void {
  try {
    localStorage.setItem(key(projectId, "files"), JSON.stringify(files))
  } catch {
    /* localStorage unavailable → in-memory only for this run */
  }
}

let fseq = 0
function newFileId(): string {
  fseq += 1
  return `f_${Date.now().toString(36)}_${fseq}`
}

export function useProjectContent(projectId: string): ProjectContent {
  const [instructions, setInstr] = useState(() => loadStr(projectId, "instructions"))
  const [memory, setMem] = useState(() => loadStr(projectId, "memory"))
  const [files, setFiles] = useState<ProjectFile[]>(() => loadFiles(projectId))
  const filesRef = useRef(files)

  // Reload when the project changes (this hook is reused across projects).
  useEffect(() => {
    setInstr(loadStr(projectId, "instructions"))
    setMem(loadStr(projectId, "memory"))
    const f = loadFiles(projectId)
    filesRef.current = f
    setFiles(f)
  }, [projectId])

  // Each setter persists SYNCHRONOUSLY, so an edit survives even if the view unmounts right
  // after (same hazard fixed in the projects store).
  const setInstructions = useCallback(
    (v: string) => {
      setInstr(v)
      saveStr(projectId, "instructions", v)
    },
    [projectId],
  )
  const setMemory = useCallback(
    (v: string) => {
      setMem(v)
      saveStr(projectId, "memory", v)
    },
    [projectId],
  )
  const addFile = useCallback(
    (name: string, content: string) => {
      const next = [{ id: newFileId(), name: name.trim() || "note", content }, ...filesRef.current]
      filesRef.current = next
      saveFiles(projectId, next)
      setFiles(next)
    },
    [projectId],
  )
  const removeFile = useCallback(
    (id: string) => {
      const next = filesRef.current.filter((f) => f.id !== id)
      filesRef.current = next
      saveFiles(projectId, next)
      setFiles(next)
    },
    [projectId],
  )

  return { instructions, setInstructions, memory, setMemory, files, addFile, removeFile }
}
