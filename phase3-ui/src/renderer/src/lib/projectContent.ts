import { useCallback, useEffect, useRef, useState } from "react"
import { reportStorageWrite } from "./storageHealth"

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

// The three parts a project owns. Also the key space for save reporting below.
export type ContentPart = "instructions" | "memory" | "files"

// The outcome of the MOST RECENT write for one part. `ok: false` means the write genuinely
// FAILED (quota exceeded, storage blocked) and the value now lives in memory only.
//
// This exists because the UI shows a "Saved" indicator. Every save path below therefore
// reports its real result instead of swallowing the exception: an indicator wired to an
// assumed success would show "Saved" for writes that silently failed, which is strictly
// worse than having no indicator — it makes an untrustworthy thing look trustworthy.
export interface SaveResult {
  ok: boolean
  at: number
}

export interface ProjectContent {
  instructions: string
  setInstructions: (v: string) => void
  memory: string
  setMemory: (v: string) => void
  files: ProjectFile[]
  addFile: (name: string, content: string) => void
  removeFile: (id: string) => void
  // Per-part result of the last write. Absent = nothing written yet this session (so the UI
  // shows no indicator rather than an unearned "Saved").
  saveState: Partial<Record<ContentPart, SaveResult>>
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
// Returns whether the write actually landed. Exported for the unit test that forces a
// failure — the failure path is the one that matters here and it must be provable.
export function saveStr(projectId: string, part: string, v: string): boolean {
  try {
    localStorage.setItem(key(projectId, part), v)
    return true
  } catch {
    return false // quota exceeded or storage blocked → in-memory only; the caller MUST surface this
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
export function saveFiles(projectId: string, files: ProjectFile[]): boolean {
  try {
    localStorage.setItem(key(projectId, "files"), JSON.stringify(files))
    return true
  } catch {
    return false // see saveStr — a failed write must reach the UI, not be swallowed
  }
}

// The parts a project owns in localStorage. Exposed via delete/copy helpers so the projects
// store can DROP a deleted project's content (privacy — it must not linger on disk) and CARRY
// a duplicated project's content to the new id, without knowing the key layout.
const CONTENT_PARTS = ["instructions", "memory", "files"] as const

export function deleteProjectContent(projectId: string): boolean {
  try {
    for (const part of CONTENT_PARTS) localStorage.removeItem(key(projectId, part))
    return true
  } catch {
    return false // content may linger on disk — the caller must surface that, not hide it
  }
}

// Copies a project's content to a new id. Returns false if ANY part failed to copy.
//
// On failure it rolls back whatever it had already written, so a failed duplicate never leaves
// a half-populated project behind — the same "must not linger on disk" concern
// deleteProjectContent exists for. Without this, a quota failure partway through would strand
// orphaned keys under an id that may not even become a real project.
export function copyProjectContent(fromId: string, toId: string): boolean {
  const written: string[] = []
  try {
    for (const part of CONTENT_PARTS) {
      const v = localStorage.getItem(key(fromId, part))
      if (v !== null) {
        localStorage.setItem(key(toId, part), v)
        written.push(part)
      }
    }
    return true
  } catch {
    try {
      for (const part of written) localStorage.removeItem(key(toId, part))
    } catch {
      /* storage is already failing; the rollback is best-effort */
    }
    return false
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
  const [saveState, setSaveState] = useState<Partial<Record<ContentPart, SaveResult>>>({})
  const filesRef = useRef(files)

  // Record what a write ACTUALLY did, so the UI reports the real outcome per part. Also feeds
  // the shared storage-health signal under a per-(project, part) key, so the app-wide warning
  // reflects THIS part's outcome without a success elsewhere clearing a still-failing part.
  const noteSave = useCallback(
    (part: ContentPart, ok: boolean) => {
      reportStorageWrite(`content:${projectId}:${part}`, ok)
      setSaveState((s) => ({ ...s, [part]: { ok, at: Date.now() } }))
    },
    [projectId],
  )

  // Reload when the project changes (this hook is reused across projects).
  useEffect(() => {
    setInstr(loadStr(projectId, "instructions"))
    setMem(loadStr(projectId, "memory"))
    const f = loadFiles(projectId)
    filesRef.current = f
    setFiles(f)
    setSaveState({}) // a different project has written nothing yet — don't carry over a stale "Saved"
  }, [projectId])

  // Each setter persists SYNCHRONOUSLY, so an edit survives even if the view unmounts right
  // after (same hazard fixed in the projects store). This is also why there is no Save button
  // and no debounced write: buffering edits until a click — or behind a timer — would
  // reintroduce exactly that unmount-loses-the-edit hazard. The indicator reports the write;
  // it never gates it.
  const setInstructions = useCallback(
    (v: string) => {
      setInstr(v)
      noteSave("instructions", saveStr(projectId, "instructions", v))
    },
    [projectId, noteSave],
  )
  const setMemory = useCallback(
    (v: string) => {
      setMem(v)
      noteSave("memory", saveStr(projectId, "memory", v))
    },
    [projectId, noteSave],
  )
  const addFile = useCallback(
    (name: string, content: string) => {
      const next = [{ id: newFileId(), name: name.trim() || "note", content }, ...filesRef.current]
      filesRef.current = next
      noteSave("files", saveFiles(projectId, next))
      setFiles(next)
    },
    [projectId, noteSave],
  )
  const removeFile = useCallback(
    (id: string) => {
      const next = filesRef.current.filter((f) => f.id !== id)
      filesRef.current = next
      noteSave("files", saveFiles(projectId, next))
      setFiles(next)
    },
    [projectId, noteSave],
  )

  return { instructions, setInstructions, memory, setMemory, files, addFile, removeFile, saveState }
}
