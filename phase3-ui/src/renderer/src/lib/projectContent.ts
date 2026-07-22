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

// The parts a project owns (the key space for save reporting below). `autoMemory` is the durable
// project memory — user-editable now, auto-generated from the project's chats in AM-2b; it is NOT a
// CONTENT_PART (below), so it is neither copied on duplicate (it's derived from chats a duplicate
// won't have) nor cleared by deleteProjectContent — deleteProjectMemoryState owns its lifecycle.
export type ContentPart = "instructions" | "memory" | "files" | "autoMemory"

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
  // Durable project memory: user-editable, and auto-generated from the project's chats (AM-2b).
  autoMemory: string
  setAutoMemory: (v: string) => void
  // A regenerated memory awaiting review (null = none pending). Regeneration NEVER overwrites the
  // accepted memory — it stages a proposal the user Accepts (adopt) or Discards (keep current).
  autoMemoryProposal: MemoryProposal | null
  setMemoryProposal: (text: string, chatCount: number, coveredCount: number, truncated: boolean) => void
  acceptMemoryProposal: () => void
  discardMemoryProposal: () => void
  // When the accepted memory was last generated + how many chats it covered (null = never generated).
  memoryMeta: MemoryMeta | null
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

// ── Gated project-context injection (5b PR-C: Instructions; AM-1: + Memory) ──────
// Per-project consent to send this project's KNOWLEDGE (Instructions + Memory) to a CLOUD model.
// Default FALSE: curated private knowledge never egresses to a cloud provider until the user opts in
// per-project. Stored under the project's own namespace, so it MUST be cleared by purgeProjectStorage.
const CONSENT_PART = "cloudConsent"
export function hasCloudConsent(projectId: string): boolean {
  return loadStr(projectId, CONSENT_PART) === "1"
}
export function allowCloudConsent(projectId: string): boolean {
  return saveStr(projectId, CONSENT_PART, "1")
}
export function deleteProjectConsent(projectId: string): boolean {
  try {
    localStorage.removeItem(key(projectId, CONSENT_PART))
    return true
  } catch {
    return false // consent flag may linger — the caller must surface that, not hide it
  }
}

// Assemble a project's knowledge (Instructions + Memory, each labelled) into the `system` string sent
// with every project-chat prompt — GATED so it NEVER egresses to a cloud model without per-project
// consent. Returns undefined when there's nothing to attach OR when a cloud model lacks consent
// (withhold ALL project knowledge, the safe default; the send still happens). Pure + fed the LIVE
// editor values by ProjectChat, so what the user sees is exactly what's sent. Unit-tested
// (assert-then-mutate): flip any input — empty, cloud-without-consent — and it withholds.
export function buildProjectSystem(args: {
  instructions: string
  memory: string
  autoMemory: string
  isLocal: boolean
  consent: boolean
}): string | undefined {
  const sections = [
    args.instructions.trim() && `Project instructions:\n${args.instructions.trim()}`,
    args.memory.trim() && `Project notes:\n${args.memory.trim()}`,
    args.autoMemory.trim() && `Project memory:\n${args.autoMemory.trim()}`,
  ].filter(Boolean) as string[]
  if (sections.length === 0) return undefined // nothing to attach
  if (!(args.isLocal || args.consent)) return undefined // cloud + no consent → withhold ALL of it
  return sections.join("\n\n")
}

// Whether a project has ANY knowledge (Instructions, manual Notes, or auto Memory) worth gating —
// drives the consent banner, so it doesn't nag when there's nothing to protect.
export function hasProjectContext(args: { instructions: string; memory: string; autoMemory: string }): boolean {
  return args.instructions.trim().length > 0 || args.memory.trim().length > 0 || args.autoMemory.trim().length > 0
}

// A regenerated auto-memory awaiting the user's Accept/Discard (AM-2b). Carries `chatCount` (the
// project's full chat count, stamped into the meta on Accept for staleness) and `coveredCount` (how
// many chats the summary was actually based on) so the review can flag partial coverage — both
// persist with the proposal so they survive a remount before the user decides.
export interface MemoryProposal {
  text: string
  chatCount: number
  coveredCount: number
  truncated: boolean // content was dropped/shortened to fit — flag partial coverage even at 1-of-1
}
// Metadata for the ACCEPTED auto-memory (not the proposal): when it was generated + how many chats it
// covered, so the UI can show "last updated" and a count-based "N new chats since" staleness hint.
export interface MemoryMeta {
  lastGeneratedAt: number
  sourceChatCount: number
}
function loadJson<T>(projectId: string, part: string): T | null {
  try {
    const raw = localStorage.getItem(key(projectId, part))
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null // absent or garbage → treat as none
  }
}

// Clear ALL auto-memory state — the accepted memory, the pending proposal, and the generation meta.
// Own delete path — NOT part of deleteProjectContent's CONTENT_PARTS, since auto-memory is derived
// from a project's chats and must not ride along on a duplicate. Joins purgeProjectStorage's fan-out
// (the NJ-40/41 leak class). Best-effort: reports false if ANY removal throws.
export function deleteProjectMemoryState(projectId: string): boolean {
  try {
    localStorage.removeItem(key(projectId, "autoMemory"))
    localStorage.removeItem(key(projectId, "autoMemoryProposal"))
    localStorage.removeItem(key(projectId, "memoryMeta"))
    return true
  } catch {
    return false // may linger — the caller must surface that, not hide it
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
  const [autoMemory, setAuto] = useState(() => loadStr(projectId, "autoMemory"))
  const [autoMemoryProposal, setProposal] = useState<MemoryProposal | null>(() => loadJson<MemoryProposal>(projectId, "autoMemoryProposal"))
  const [memoryMeta, setMeta] = useState<MemoryMeta | null>(() => loadJson<MemoryMeta>(projectId, "memoryMeta"))
  const [files, setFiles] = useState<ProjectFile[]>(() => loadFiles(projectId))
  const [saveState, setSaveState] = useState<Partial<Record<ContentPart, SaveResult>>>({})
  const filesRef = useRef(files)

  // Record what a write ACTUALLY did, so the per-part chip reports the real outcome. This is a
  // property of THIS part's own last write, so it is accurate by construction and needs no
  // cross-part reconciliation — the app-wide "storage health" signal that did try to reconcile
  // was removed as a stopgap with lifecycle edges of its own (see NJ-41).
  const noteSave = useCallback((part: ContentPart, ok: boolean) => {
    setSaveState((s) => ({ ...s, [part]: { ok, at: Date.now() } }))
  }, [])

  // Reload when the project changes (this hook is reused across projects).
  useEffect(() => {
    setInstr(loadStr(projectId, "instructions"))
    setMem(loadStr(projectId, "memory"))
    setAuto(loadStr(projectId, "autoMemory"))
    setProposal(loadJson<MemoryProposal>(projectId, "autoMemoryProposal"))
    setMeta(loadJson<MemoryMeta>(projectId, "memoryMeta"))
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
  const setAutoMemory = useCallback(
    (v: string) => {
      setAuto(v)
      noteSave("autoMemory", saveStr(projectId, "autoMemory", v))
    },
    [projectId, noteSave],
  )
  // Stage a regenerated memory for review (does NOT touch the accepted memory). Persisted so it
  // survives navigating away and back before the user decides.
  const setMemoryProposal = useCallback(
    (text: string, chatCount: number, coveredCount: number, truncated: boolean) => {
      const p: MemoryProposal = { text, chatCount, coveredCount, truncated }
      setProposal(p)
      try {
        localStorage.setItem(key(projectId, "autoMemoryProposal"), JSON.stringify(p))
      } catch {
        /* proposal lives in memory only this session — Accept still works from state */
      }
    },
    [projectId],
  )
  // Adopt the pending proposal as the accepted memory and stamp the meta (what it covered + now),
  // then clear the proposal. Reads the current proposal from the closure (Accept is a single
  // deliberate click, and `autoMemoryProposal` is in deps, so it's never stale) and does its side
  // effects OUTSIDE any setState updater (updaters must stay pure). Date.now() is fine in the renderer.
  const acceptMemoryProposal = useCallback(() => {
    const cur = autoMemoryProposal
    if (!cur) return
    setAuto(cur.text)
    noteSave("autoMemory", saveStr(projectId, "autoMemory", cur.text))
    const meta: MemoryMeta = { lastGeneratedAt: Date.now(), sourceChatCount: cur.chatCount }
    setMeta(meta)
    setProposal(null)
    // Clear the proposal key FIRST and in its OWN try, so a failing meta write (quota) can't skip it
    // and leave a stale proposal that rehydrates the accepted review on remount (Bugbot).
    try {
      localStorage.removeItem(key(projectId, "autoMemoryProposal"))
    } catch {
      /* the proposal lives in memory only now — still cleared for this session */
    }
    try {
      localStorage.setItem(key(projectId, "memoryMeta"), JSON.stringify(meta))
    } catch {
      /* meta not persisted; state is already updated */
    }
  }, [projectId, noteSave, autoMemoryProposal])
  const discardMemoryProposal = useCallback(() => {
    setProposal(null)
    try {
      localStorage.removeItem(key(projectId, "autoMemoryProposal"))
    } catch {
      /* nothing more to do */
    }
  }, [projectId])
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

  return {
    instructions,
    setInstructions,
    memory,
    setMemory,
    autoMemory,
    setAutoMemory,
    autoMemoryProposal,
    setMemoryProposal,
    acceptMemoryProposal,
    discardMemoryProposal,
    memoryMeta,
    files,
    addFile,
    removeFile,
    saveState,
  }
}
