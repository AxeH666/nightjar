// SessionsContext — the multi-session registry (redesign Stage 4). Supersedes
// the single-session ChatContext: each tab slot (chat / code) binds to its OWN
// OpenCode session, so Chat and Code hold independent conversations. The ONE
// instance-wide SSE stream (ConnectionContext) is demultiplexed by sessionID —
// membership in perSessionRefs IS the old `mine` check, generalized.
//
// The streaming reducer (the NJ-3 dedup: roleById/pendingParts/textParts +
// optimistic user render) is preserved VERBATIM, just scoped per session.
//
// Session lifecycle:
//   • chat slot = ConnectionContext's primary session (adopted; rebinds on
//     reconnect, carrying the transcript over so it doesn't vanish — matching
//     the pre-refactor behaviour where messages persisted across a reconnect).
//   • code slot = created here after connect, recreated on reconnect.
//   • resume/list/delete/rename drive the Code tab's session-history list.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { toolCallFromPart } from "../lib/opencode"
import type { OpenCodeEvent, FilePart, SessionInfo, MessageWithParts } from "../lib/opencode"
import { type UiMessage, type UiBlock } from "../components/ChatSurface"
import { claimsFileButNoneWritten } from "../lib/saveClaim"
import { type Attachment, loadGeneratedImage } from "../lib/attachments"
import { cad } from "../lib/cad"
import { isLocalModel, LOCAL_MODEL, OPENROUTER_FREE_CHOICE } from "../lib/byok"
import { loadProjectChatIds, saveProjectChatIds, sessionIdsKey, sameChatScope, displayChatTitle, type ChatMoveScope } from "../lib/sessionScope"
import { assembleTranscripts, buildSummaryPrompt, type ChatTranscript } from "../lib/autoMemory"
import { useConnection, useOpenCodeEvents } from "./ConnectionContext"
import { useModel, type SendKind } from "./ModelContext"
import { useArtifact } from "./ArtifactContext"

export type SlotId = "chat" | "code" | "cad"

export interface SessionState {
  id: string
  agent: string // default agent for sends in this session (overridable per send)
  title: string
  messages: UiMessage[]
  busy: boolean
}

// Per-session streaming-assembly buffers (the NJ-3 machinery), kept in a ref
// outside React state so the SSE reducer needn't resubscribe.
interface RefBundle {
  textParts: Map<string, { messageID: string; text: string }>
  roleById: Map<string, "user" | "assistant">
  pendingParts: Map<string, any[]>
  loadedImages: Set<string>
  lastSent: string
  lastKind: SendKind // what the last send was (chat|image) → correct retry dispatch (NJ-9)
  lastModel: string // the model the last send used → recovery judged on it, not global (B4)
  // NJ-7: track a Create-Image turn so we can retry ONCE with a stronger directive if
  // the (small local) model finishes the turn without ever calling generate_image.
  imageGen?: { prompt: string; agent: string; model: string; retried: boolean; sawTool: boolean; lastIdleAt?: number }
  // CAD viewer handoff: on a cad-agent turn, `export` (STEP→GLB) is the ONLY thing that
  // populates the 3D viewer — `render_view` is a PNG the user never sees. If the model
  // builds/renders but never exports, auto-send ONE export directive on idle so the viewer
  // fills without relying on the model choosing export. Bounded by `retried` (no loop).
  cadExport?: { agent: string; model: string; sawBuild: boolean; sawExport: boolean; retried: boolean; lastIdleAt?: number }
}
const freshRefs = (): RefBundle => ({
  textParts: new Map(),
  roleById: new Map(),
  pendingParts: new Map(),
  loadedImages: new Set(),
  lastSent: "",
  lastKind: "chat",
  lastModel: "",
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const DEFAULT_AGENT: Record<SlotId, string> = { chat: "assistant", code: "coding", cad: "cad" }
const DEFAULT_TITLE: Record<SlotId, string> = { chat: "June chat", code: "June coding", cad: "June CAD" }

// Client-side "kind" tag for sessions, PER SLOT. OpenCode has NO per-session kind, so we
// remember which session ids have served each history slot (created or resumed into that
// slot) and persist it across restarts — a slot's history rail lists only its own ids,
// never another slot's session or unrelated pre-existing histories. Only slots with a
// resumable history rail need this (code + each lab, e.g. cad); the chat slot is the
// adopted primary and has no list. localStorage is renderer-only and can be unavailable/
// blocked, so every access is guarded and degrades to in-memory-only for the current run.
const HISTORY_SLOTS: SlotId[] = ["code", "cad", "chat"]
const isHistorySlot = (slot: SlotId): boolean => HISTORY_SLOTS.includes(slot)
// sessionIdsKey is imported from lib/sessionScope (single source of truth for the General keys — a
// SlotId is a BaseSlot, so it resolves to the same "nightjar.codeSessionIds"/"nightjar.sessionIds.*"
// strings this file used to build locally; the zero-migration contract is pinned by its test).
function loadSessionIds(slot: SlotId): Set<string> {
  try {
    const raw = localStorage.getItem(sessionIdsKey(slot))
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}
function persistSessionIds(slot: SlotId, ids: Set<string>): void {
  try {
    localStorage.setItem(sessionIdsKey(slot), JSON.stringify([...ids]))
  } catch {
    /* localStorage unavailable → this run keeps the set in memory only */
  }
}

// Rehydrate a resumed session's history (WithParts[]) into UiMessage[]. Unlike
// the live path (which drops the user echo and renders it optimistically), a
// replayed session renders BOTH user and assistant messages from their parts.
function messagesFromHistory(history: MessageWithParts[]): UiMessage[] {
  const sorted = [...history].sort((a, b) => (a.info?.time?.created ?? 0) - (b.info?.time?.created ?? 0))
  const out: UiMessage[] = []
  for (const { info, parts } of sorted) {
    const role: "user" | "assistant" = info.role === "user" ? "user" : "assistant"
    const blocks: UiBlock[] = []
    for (const part of parts ?? []) {
      if (part.type === "text" && typeof part.text === "string" && part.text.trim()) {
        blocks.push({ kind: "text", text: part.text } as UiBlock)
      } else if (part.type === "tool") {
        const call = toolCallFromPart(part)
        if (call) blocks.push({ kind: "tool", call })
      } else if (part.type === "file") {
        const mime: string = part.mime ?? ""
        const name: string = part.filename ?? "file"
        if (/^image\//i.test(mime) && typeof part.url === "string") blocks.push({ kind: "image", src: part.url, name })
        else blocks.push({ kind: "file", name, mime })
      }
    }
    if (blocks.length) out.push({ id: info.id, role, blocks })
  }
  return out
}

interface SessionsValue {
  // registry
  sessions: Record<string, SessionState>
  slots: Record<SlotId, string>
  messagesOf: (id: string) => UiMessage[]
  busyOf: (id: string) => boolean
  // actions (general — a screen passes the target session id)
  send: (sessionId: string, text: string, opts?: { agent?: string; attachments?: Attachment[]; model?: string; system?: string }) => void
  createImage: (sessionId: string, prompt: string, opts?: { model?: string }) => void
  setSessionAgent: (sessionId: string, agent: string) => void
  // session-history list (Code tab)
  listSessions: () => Promise<SessionInfo[]>
  resumeSession: (slot: SlotId, sessionId: string, agent: string, title?: string) => Promise<void>
  newSession: (slot: SlotId, agent: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  // 5b — per-project chat isolation (multi-chat). projectChats = each project's ACTIVE chat id;
  // projectChatIds = each project's history list (newest first) for its rail. openProjectChat
  // resolves the active chat when a project opens; newProjectChat/resumeProjectChat drive the
  // rail's ＋ and resume; deleteProjectChat drops ALL of a project's chats on project removal.
  // These live in parallel maps, NOT in `slots`.
  projectChats: Record<string, string>
  projectChatIds: Record<string, string[]>
  openProjectChat: (projectId: string) => Promise<string>
  newProjectChat: (projectId: string) => Promise<string>
  resumeProjectChat: (projectId: string, sessionId: string) => Promise<void>
  deleteProjectChat: (projectId: string) => Promise<void>
  deleteProjectChatOne: (projectId: string, sessionId: string) => Promise<void>
  // Chat menu (PR-2) — re-file a chat between scopes (General ↔ project, project ↔ project). Pure
  // client-side re-tag between the id-lists; the engine session/transcript is untouched. If the
  // moved chat was the source rail's ACTIVE chat, the source resolves a replacement (never deletes
  // the moved session). Resolves TRUE if a move happened, FALSE on a no-op / abort (same scope,
  // deleted target, or a failed active-General replacement) — the caller unpins only when true.
  moveChatToScope: (sessionId: string, from: ChatMoveScope, to: ChatMoveScope) => Promise<boolean>
  // Auto-memory (AM-2b) — summarise a project's chats into a memory paragraph on the LOCAL model,
  // via an EPHEMERAL throwaway session (never registered, never shown, never egressed). Returns the
  // summary text + how many chats it covered, or a surfaced error. The caller stages it as a proposal
  // (projectContent) for the user to Accept/Discard — this never writes the memory itself.
  summarizeProjectChats: (
    projectId: string,
    currentMemory: string,
  ) => Promise<{ ok: true; summary: string; chatCount: number; coveredCount: number; truncated: boolean } | { ok: false; error: string }>
  // safety-critical accessors (PermissionContext)
  hasSession: (sid: string) => boolean
  setBusy: (sid: string, val: boolean) => void
  // per-slot session-kind registry (each history slot's list — Code + labs); persisted client-side
  sessionIdsBySlot: Record<SlotId, Set<string>>
  // CAD (Task 5): the current converted model for the viewer + whether a conversion is
  // running. The CAD agent's export tool completing drives these; the CAD screen renders them.
  cadModel: { glb: ArrayBuffer; parts: string[] } | null
  cadBusy: boolean
  cadError: string | null
  clearCadModel: () => void
  loadCadHero: () => void // build + show the pre-authored planetary-gearset demo
  // recovery offers (chat slot)
  fallbackToLocal: () => void
  acceptOpenRouterSwitch: () => void
}

const Ctx = createContext<SessionsValue | null>(null)

export function useSessions(): SessionsValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useSessions must be used within a SessionsProvider")
  return v
}

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { clientRef, sessionID: primaryId, agents, setStatus } = useConnection()
  const { activeModel, setActiveModel, fallbackOffer, setFallbackOffer, rateLimitOffer, setRateLimitOffer, handleSessionError } =
    useModel()
  const { onToolCall } = useArtifact()

  const [sessions, setSessions] = useState<Record<string, SessionState>>({})
  const [slots, setSlots] = useState<Record<SlotId, string>>({ chat: "", code: "", cad: "" })
  // CAD viewer model + conversion status (Task 5).
  const [cadModel, setCadModel] = useState<{ glb: ArrayBuffer; parts: string[] } | null>(null)
  const [cadBusy, setCadBusy] = useState(false)
  const [cadError, setCadError] = useState<string | null>(null)
  // Which export tool-calls have been SUCCESSFULLY shown (or genuinely errored) — by callID, a
  // component-level ref (survives a reconnect's session rebind; Bugbot). A superseded convert
  // is deliberately NOT added here, so it stays re-eligible (Bugbot: clicking Load demo mid-
  // convert must not permanently strand a completed agent export). convertingExportsRef guards
  // against re-triggering an export that's currently in flight (no re-convert loop). cadGenRef
  // is a monotonic "latest wins" token so a slow older convert never clobbers a newer model.
  const processedExportsRef = useRef<Set<string>>(new Set())
  const convertingExportsRef = useRef<Set<string>>(new Set())
  const cadGenRef = useRef(0)
  // Bumped to re-run the export watcher when nothing else changed (e.g. a demo load failed and
  // a superseded agent export should now re-surface).
  const [cadRetryTick, setCadRetryTick] = useState(0)
  const clearCadModel = useCallback(() => {
    setCadModel(null)
    setCadError(null)
  }, [])
  const loadCadHero = useCallback(() => {
    // The demo bypasses the agent entirely — a newer generation so a slow agent export
    // in flight can't clobber the demo (and vice-versa).
    const gen = ++cadGenRef.current
    setCadBusy(true)
    setCadError(null)
    cad
      .loadHero()
      .then((res) => {
        if (gen !== cadGenRef.current) return
        if ("error" in res) {
          setCadError(res.error)
          // The demo failed after superseding any in-flight agent export. Re-run the watcher
          // so a completed-but-superseded export can re-surface instead of being stranded.
          setCadRetryTick((t) => t + 1)
        } else {
          setCadModel({ glb: res.glb, parts: res.parts })
          // Demo shown by explicit user choice: mark existing completed exports processed so a
          // later message tick can't re-surface an old export over the demo the user asked for.
          const cadId = slotsRef.current.cad
          for (const m of (cadId && sessionsRef.current[cadId]?.messages) || [])
            for (const b of m.blocks)
              if (b.kind === "tool" && b.call.status === "completed" && /build123d_export/i.test(b.call.tool))
                processedExportsRef.current.add(b.call.callID)
        }
      })
      .catch((e) => {
        if (gen !== cadGenRef.current) return
        setCadError(e instanceof Error ? e.message : String(e))
        setCadRetryTick((t) => t + 1)
      })
      .finally(() => {
        if (gen === cadGenRef.current) setCadBusy(false)
      })
  }, [])
  // Per-slot persisted sets of session ids that have served each history slot (see the
  // module-level helpers). Each slot's history rail filters GET /session down to its set.
  const [sessionIdsBySlot, setSessionIdsBySlot] = useState<Record<SlotId, Set<string>>>(() => ({
    chat: loadSessionIds("chat"),
    code: loadSessionIds("code"),
    cad: loadSessionIds("cad"),
  }))
  const markSlotSession = useCallback((slot: SlotId, id: string) => {
    setSessionIdsBySlot((prev) => {
      if (!id || prev[slot].has(id)) return prev
      const nextSet = new Set(prev[slot]).add(id)
      persistSessionIds(slot, nextSet)
      return { ...prev, [slot]: nextSet }
    })
  }, [])
  const unmarkSlotSession = useCallback((slot: SlotId, id: string) => {
    setSessionIdsBySlot((prev) => {
      if (!prev[slot].has(id)) return prev
      const nextSet = new Set(prev[slot])
      nextSet.delete(id)
      persistSessionIds(slot, nextSet)
      return { ...prev, [slot]: nextSet }
    })
  }, [])

  const perSessionRefs = useRef<Map<string, RefBundle>>(new Map())
  const sessionsRef = useRef<Record<string, SessionState>>({})
  const slotsRef = useRef<Record<SlotId, string>>({ chat: "", code: "", cad: "" })
  // Once the user picks a chat via the recents rail (New chat / resume), stop auto-adopting the
  // connection's primary onto the chat slot — otherwise a (re)connect would clobber their choice.
  const chatBoundManually = useRef(false)

  // 5b — per-project chat isolation. Two parallel maps kept DELIBERATELY OUTSIDE the fixed `slots`
  // record so none of the base chat/code/cad machinery — the primary-adopt effect, the
  // chatBoundManually pins, rebindSlot — is touched (that machinery is the hard-won #122/#123 path
  // and must not regress):
  //   • projectChats:   projectId → the ACTIVE (currently-open) chat session id for that project.
  //   • projectChatIds: projectId → that project's history list (newest first) for its rail.
  // Only the ACTIVE chat is a loaded session (in perSessionRefs/sessions); the rest are ids the
  // rail lists and resumes on click. The two places a project chat is NOT free from `slots` are
  // handled explicitly: gcSessions preserves the ACTIVE ids (or a reconnect would GC a live
  // conversation), and the Chat-only honesty guardrail fires for them too (a project chat is
  // equally a write-tool-less assistant chat). See research/5b_PLAN.md.
  const [projectChats, setProjectChats] = useState<Record<string, string>>({})
  const projectChatsRef = useRef<Record<string, string>>({})
  const [projectChatIds, setProjectChatIds] = useState<Record<string, string[]>>({})
  const projectChatIdsRef = useRef<Record<string, string[]>>({})
  // Projects deleted this session. deleteProjectChat adds the id SYNCHRONOUSLY (before the store's
  // purge), and every project-chat write path checks this first — so an openProjectChat still
  // in-flight when the project is deleted can't resurrect its state or re-persist its storage keys
  // after the purge (Bugbot). Ids are unique + never reused, so the set never blocks a new project.
  const deletedProjectsRef = useRef<Set<string>>(new Set())
  // Individual chat session ids deleted this session (deleteProjectChatOne). Added SYNCHRONOUSLY at
  // delete time; bind/mark check it, so an openProjectChat still resolving a chat the user just
  // deleted can't bind or re-add the now-dead id (Bugbot). Ids are unique + never reused.
  const deletedChatsRef = useRef<Set<string>>(new Set())
  // Per-project "latest selection" counter. new/resume capture it at click time and re-check before
  // committing their async result, so when the user clicks several rail chats (or ＋New) faster than
  // getMessages/createSession resolves, the LAST click wins instead of the last-completing request
  // (Bugbot).
  const projectSelectSeq = useRef<Record<string, number>>({})
  const nextSelectSeq = useCallback((projectId: string): number => {
    const n = (projectSelectSeq.current[projectId] ?? 0) + 1
    projectSelectSeq.current[projectId] = n
    return n
  }, [])
  // Move's in-flight-revive guard: sessionId → the scope it was most recently moved OUT of. Set
  // SYNCHRONOUSLY at move time (before any await), and consulted by markProjectChat/bindProjectChat
  // (project scopes) and resumeSession (the General chat slot) so a resume/open that resolves AFTER a
  // move can't re-add the moved chat to the scope it just left — it would otherwise appear in BOTH
  // scopes. This is the move analogue of deletedChatsRef, but PER-SOURCE-SCOPE rather than permanent:
  // a chat is not dead, so it stays freely bindable in its NEW home (target scope ≠ source scope, so
  // the move's own target-attach is never blocked) and re-bindable in its old one once moved back
  // (each move OVERWRITES the entry with the new source). Precise per-chat — unlike a per-rail seq
  // bump, moving one chat never cancels an in-flight resume of a DIFFERENT chat on the same rail.
  const movedOutOfRef = useRef<Map<string, ChatMoveScope>>(new Map())
  const movedOutOf = useCallback((id: string, scope: ChatMoveScope): boolean => {
    const m = movedOutOfRef.current.get(id)
    return !!m && sameChatScope(m, scope)
  }, [])
  // In-flight openProjectChat promises, keyed by projectId, so concurrent opens for the same
  // project share ONE resolve instead of racing to create two sessions (Bugbot).
  //
  // NOTE (simplified model, 2026-07-21): OpenCode persists sessions in its SQLite DB, so a project
  // chat SURVIVES an engine restart/reconnect — the in-memory binding stays valid and gcSessions
  // (via the chat-adopt rebind) already preserves it. So this deliberately does NOT proactively
  // re-validate liveness (listSessions) on open/resume: that guarded a rare case (true session
  // loss) at the cost of a large concurrency surface. A genuinely-dead session is handled lazily —
  // its send simply errors, and the user starts a New chat. This replaced a generation/revalidation
  // machine that produced ~12 review findings over 6 rounds (see research/5b_PLAN.md).
  const projectChatOpening = useRef<Map<string, Promise<string>>>(new Map())
  useEffect(() => {
    projectChatsRef.current = projectChats
  }, [projectChats])
  useEffect(() => {
    projectChatIdsRef.current = projectChatIds
  }, [projectChatIds])
  // Record a chat id in a project's history (newest first, deduped) + persist. Called on new/resume.
  const markProjectChat = useCallback((projectId: string, id: string) => {
    // Never resurrect a deleted project/chat, and never re-add a chat to the project it was just
    // moved OUT of (a stale in-flight open/resume resolving after the move — movedOutOfRef).
    if (!projectId || !id || deletedProjectsRef.current.has(projectId) || deletedChatsRef.current.has(id) || movedOutOf(id, { kind: "project", projectId })) return
    const cur = projectChatIdsRef.current[projectId] ?? loadProjectChatIds(projectId)
    const next = [id, ...cur.filter((x) => x !== id)]
    projectChatIdsRef.current = { ...projectChatIdsRef.current, [projectId]: next }
    saveProjectChatIds(projectId, next)
    setProjectChatIds((prev) => ({ ...prev, [projectId]: next }))
  }, [movedOutOf])
  // True if `sid` is any chat-scope session (the General chat slot OR an active project chat) — the
  // set the honesty guardrail must cover. Reads refs so it's stable and current at event time.
  const isChatScope = useCallback(
    (sid: string): boolean => slotsRef.current.chat === sid || Object.values(projectChatsRef.current).includes(sid),
    [],
  )
  const agentsRef = useRef(agents) // stable read of the live agent list (for validAgent, without a deps cascade)
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])
  useEffect(() => {
    slotsRef.current = slots
  }, [slots])
  useEffect(() => {
    agentsRef.current = agents
  }, [agents])

  // ---- registry helpers ----
  const updateMessages = useCallback((sid: string, fn: (msgs: UiMessage[]) => UiMessage[]) => {
    setSessions((prev) => {
      const s = prev[sid]
      if (!s) return prev
      return { ...prev, [sid]: { ...s, messages: fn(s.messages) } }
    })
  }, [])

  const setBusy = useCallback((sid: string, val: boolean) => {
    setSessions((prev) => (prev[sid] ? { ...prev, [sid]: { ...prev[sid], busy: val } } : prev))
  }, [])

  const setSessionAgent = useCallback((sid: string, agent: string) => {
    setSessions((prev) => (prev[sid] ? { ...prev, [sid]: { ...prev[sid], agent } } : prev))
  }, [])

  const hasSession = useCallback((sid: string) => perSessionRefs.current.has(sid), [])
  const messagesOf = useCallback((id: string) => sessions[id]?.messages ?? [], [sessions])
  const busyOf = useCallback((id: string) => sessions[id]?.busy ?? false, [sessions])

  // Which slot (if any) currently holds this session — used to make a recovery
  // retry survive a reconnect that replaced the session id (Bugbot #1).
  const slotOf = useCallback(
    (sid: string): SlotId | null => (Object.keys(slotsRef.current) as SlotId[]).find((s) => slotsRef.current[s] === sid) ?? null,
    [],
  )

  // Resolve a valid agent name from the live list. DEFAULT_AGENT ("assistant"/
  // "coding") may be absent from a given workspace; seed the real one at session
  // CREATION time so the first send never targets a non-existent mode (Bugbot #3
  // — the [agents] revalidation effect below runs before sessions exist and so
  // can't fix the initial ones on its own). Reads agentsRef so it stays stable.
  const validAgent = useCallback((preferred: string): string => {
    const list = agentsRef.current
    if (list.length === 0) return preferred // not loaded yet → revalidation effect heals it
    if (list.some((a) => a.name === preferred)) return preferred
    return list.find((a) => a.name === "assistant")?.name ?? list[0]?.name ?? preferred
  }, [])

  // Garbage-collect the registry so it holds EXACTLY the slot-bound sessions.
  // Any session no longer referenced by a slot stops receiving demuxed SSE and
  // is no longer eligible for a global permission prompt (hasSession) — this
  // closes the orphaned-session leaks in resume/delete/rebind. Reads slotsRef,
  // which callers update synchronously *before* calling this.
  const gcSessions = useCallback(() => {
    // Bound = every slot session PLUS every open project chat. Project chats live outside `slots`
    // (5b), so they MUST be unioned in here or the first gcSessions after one is created — fired
    // by any rebindSlot, i.e. every reconnect recreating code/cad or re-adopting chat — would
    // forget a LIVE project conversation and abort it mid-turn. This union is the single reason
    // the parallel-map approach is GC-safe (research/5b_PLAN.md).
    const bound = new Set([...Object.values(slotsRef.current), ...Object.values(projectChatsRef.current)].filter(Boolean))
    const client = clientRef.current
    for (const id of Array.from(perSessionRefs.current.keys())) {
      if (!bound.has(id)) {
        // B9: a session we're about to FORGET but that's still mid-turn (busy) would
        // keep running on the engine and, on any permission.asked it later emits, be
        // undroppable — hasSession(id) is now false, and it has no Stop control. Cancel
        // it server-side before forgetting so it can't wedge unanswerable.
        // Synchronous belt (audit; mirrors the B3 reap at ~L498): sessionsRef.busy can
        // lag a send by one flush, so also treat a synchronously-set lastSent as busy —
        // otherwise a session GC'd in the same tick it sent (before busy flushes into
        // sessionsRef) would be forgotten un-aborted, the exact wedge B9 prevents. An
        // extra abort of an already-idle unbound session is a harmless server-side no-op.
        const busy = sessionsRef.current[id]?.busy || !!perSessionRefs.current.get(id)?.lastSent
        if (client && busy) client.abort(id).catch(() => {})
        perSessionRefs.current.delete(id)
      }
    }
    setSessions((prev) => {
      let changed = false
      const next: Record<string, SessionState> = {}
      for (const id of Object.keys(prev)) {
        if (bound.has(id)) next[id] = prev[id]
        else changed = true
      }
      return changed ? next : prev
    })
  }, [])

  // Bind a slot to a (new) session id, carrying over the old slot session's
  // transcript + agent so a reconnect doesn't wipe the visible conversation.
  // gcSessions() then forgets the previous slot session (unless another slot
  // still references it).
  const rebindSlot = useCallback(
    (slot: SlotId, newId: string, carry: boolean) => {
      const oldId = slotsRef.current[slot]
      const old = carry && oldId ? sessionsRef.current[oldId] : undefined
      perSessionRefs.current.set(newId, freshRefs())
      setSessions((prev) => ({
        ...prev,
        [newId]: {
          id: newId,
          agent: old?.agent ?? validAgent(DEFAULT_AGENT[slot]),
          title: old?.title ?? DEFAULT_TITLE[slot],
          messages: old?.messages ?? [],
          busy: false,
        },
      }))
      slotsRef.current = { ...slotsRef.current, [slot]: newId }
      setSlots((prev) => ({ ...prev, [slot]: newId }))
      gcSessions()
    },
    [gcSessions, validAgent],
  )

  // ---- upsert helpers over one session's UiMessage[] (NJ-3 machinery, verbatim) ----
  const ensureMessage = useCallback(
    (sid: string, id: string, role: "user" | "assistant") => {
      updateMessages(sid, (prev) => (prev.some((m) => m.id === id) ? prev : [...prev, { id, role, blocks: [] }]))
    },
    [updateMessages],
  )

  const setTextBlock = useCallback(
    (sid: string, messageID: string, partID: string, text: string) => {
      updateMessages(sid, (prev) =>
        prev.map((m) => {
          if (m.id !== messageID) return m
          const blocks = [...m.blocks]
          const idx = blocks.findIndex((b) => b.kind === "text" && (b as any).partID === partID)
          const block: any = { kind: "text", text, partID }
          if (idx >= 0) blocks[idx] = block
          else blocks.push(block)
          return { ...m, blocks }
        }),
      )
    },
    [updateMessages],
  )

  const upsertTool = useCallback(
    (sid: string, messageID: string, call: ReturnType<typeof toolCallFromPart>) => {
      if (!call) return
      const refs = perSessionRefs.current.get(sid)
      // NJ-7: the model DID call generate_image (any status) → cancel the retry-once.
      if (refs?.imageGen && /generate_image/i.test(call.tool)) refs.imageGen.sawTool = true
      // CAD: note whether this turn built/rendered a shape, and whether it produced a
      // SUCCESSFUL export. sawExport must match what actually fills the viewer — the watcher
      // only converts a COMPLETED export with a parseable STEP path. A failed / rejected /
      // empty export must NOT set sawExport, or it would suppress the auto-export retry and
      // leave the viewer empty with no recovery (Bugbot). By session.idle every tool call is
      // terminal, so a still-pending export can't wrongly trip the retry here.
      if (refs?.cadExport) {
        if (/build123d_export/i.test(call.tool)) {
          if (call.status === "completed" && /Exported to:?\s*\S[^\n]*?\.step\b/i.test(call.output ?? "")) refs.cadExport.sawExport = true
        } else if (/build123d_(execute|render_view)/i.test(call.tool)) {
          refs.cadExport.sawBuild = true
        }
      }
      updateMessages(sid, (prev) =>
        prev.map((m) => {
          if (m.id !== messageID) return m
          const blocks = [...m.blocks]
          const idx = blocks.findIndex((b) => b.kind === "tool" && b.call.callID === call.callID)
          if (idx >= 0) blocks[idx] = { kind: "tool", call }
          else blocks.push({ kind: "tool", call })
          return { ...m, blocks }
        }),
      )
      // Image-generation tool completed → load the PNG from disk + append inline.
      if (refs && call.status === "completed" && call.output && /generate_image/i.test(call.tool) && !refs.loadedImages.has(call.callID)) {
        const m = /generated-image\/([A-Za-z0-9._-]+\.(?:png|jpe?g|webp))/i.exec(call.output)
        if (m) {
          refs.loadedImages.add(call.callID)
          loadGeneratedImage(m[1]).then((src) => {
            if (!src) return
            updateMessages(sid, (prev) =>
              prev.map((mm) => (mm.id === messageID ? { ...mm, blocks: [...mm.blocks, { kind: "image", src, name: m[1] }] } : mm)),
            )
          })
        }
      }
      // Delegate live-preview mirroring to ArtifactContext (keyed by this session).
      onToolCall(call, sid)
    },
    [updateMessages, onToolCall],
  )

  const applyAssistantPart = useCallback(
    (sid: string, part: any) => {
      const refs = perSessionRefs.current.get(sid)
      ensureMessage(sid, part.messageID, "assistant")
      if (part.type === "text") {
        refs?.textParts.set(part.id, { messageID: part.messageID, text: part.text ?? "" })
        setTextBlock(sid, part.messageID, part.id, part.text ?? "")
      } else if (part.type === "tool") {
        upsertTool(sid, part.messageID, toolCallFromPart(part))
      }
    },
    [ensureMessage, setTextBlock, upsertTool],
  )

  // ---- SSE reducer: demultiplex by sessionID; refs presence = our session ----
  useOpenCodeEvents((e: OpenCodeEvent) => {
    const p = e.properties ?? {}
    const sid: string | undefined = p.sessionID ?? p.info?.sessionID ?? p.part?.sessionID
    if (!sid) return
    const refs = perSessionRefs.current.get(sid)
    if (!refs) return // not one of our sessions

    switch (e.type) {
      case "message.updated":
        if (p.info) {
          const role: "user" | "assistant" = p.info.role
          refs.roleById.set(p.info.id, role)
          const stashed = refs.pendingParts.get(p.info.id)
          refs.pendingParts.delete(p.info.id)
          if (role === "assistant") {
            // Only render assistant messages from the server; the user's own
            // message is already shown optimistically by send() (NJ-3).
            ensureMessage(sid, p.info.id, "assistant")
            stashed?.forEach((part) => applyAssistantPart(sid, part))
          }
          // role === "user": discard stashed parts (rendered optimistically).
        }
        break
      case "message.part.updated": {
        const part = p.part
        if (!part) break
        const role = refs.roleById.get(part.messageID)
        if (role === "user") break // known user echo → drop (NJ-3)
        if (role === undefined) {
          // Role not known yet → stash; do NOT assume assistant.
          const arr = refs.pendingParts.get(part.messageID) ?? []
          const i = arr.findIndex((q) => q.id === part.id)
          if (i >= 0) arr[i] = part
          else arr.push(part)
          refs.pendingParts.set(part.messageID, arr)
          break
        }
        applyAssistantPart(sid, part)
        break
      }
      case "message.part.delta": {
        const buf = refs.textParts.get(p.partID)
        if (buf && p.field === "text") {
          buf.text += p.delta ?? ""
          setTextBlock(sid, buf.messageID, p.partID, buf.text)
        }
        break
      }
      case "session.idle":
      case "turn.idle": {
        setBusy(sid, false)
        // NJ-7: a Create-Image turn ended. If the model never called generate_image,
        // retry ONCE with a stronger directive; on the second miss, stop (bounded by
        // `retried` — no loop, rule-3 spirit) and surface a non-silent message.
        const ig = refs.imageGen
        // Coalesce DUPLICATE idle events for one turn (the server can emit both
        // turn.idle AND session.idle): without this, the second event would advance
        // the one-shot state machine again (dispatch-then-immediately-give-up). A real
        // retry turn's idle arrives seconds later, well past this window.
        const dupeIdle = ig?.lastIdleAt !== undefined && Date.now() - ig.lastIdleAt < 800
        if (ig && !dupeIdle) ig.lastIdleAt = Date.now()
        if (dupeIdle) {
          // ignore the duplicate
        } else if (ig?.sawTool) {
          refs.imageGen = undefined // success → done
        } else if (ig && !ig.retried) {
          ig.retried = true
          const client = clientRef.current
          if (client) {
            setBusy(sid, true) // a fresh (retry) turn begins
            const stronger = `You did NOT call the generate_image tool. Call generate_image NOW with this exact description and output nothing else. Description: "${ig.prompt}".`
            client.promptAsync(sid, stronger, ig.agent, ig.model).catch((err) => {
              setBusy(sid, false)
              refs.imageGen = undefined
              setStatus(`create image retry failed: ${err?.message ?? err}`)
            })
          } else {
            refs.imageGen = undefined
          }
        } else if (ig) {
          refs.imageGen = undefined
          updateMessages(sid, (prev) => [
            ...prev,
            {
              id: `local-imgfail-${Date.now()}`,
              role: "assistant",
              blocks: [{ kind: "text", text: "I couldn't produce an image — try again, or switch to a cloud image model (BYOK)." }],
            },
          ])
        }
        // CAD viewer handoff: a cad turn ended. If it built/rendered a shape but never
        // exported (export is the ONLY thing that feeds the 3D viewer — render_view is a PNG
        // the user can't see), auto-send ONE export directive so the viewer fills. Same
        // duplicate-idle coalescing as the image retry; bounded by `retried` (no loop).
        const ce = refs.cadExport
        const dupeCad = ce?.lastIdleAt !== undefined && Date.now() - ce.lastIdleAt < 800
        if (ce && !dupeCad) ce.lastIdleAt = Date.now()
        if (dupeCad || !ce) {
          // duplicate idle, or no cad-export turn armed → nothing to do
        } else if (ce.sawExport) {
          refs.cadExport = undefined // model exported → the message watcher converts STEP→GLB → viewer
        } else if (ce.sawBuild && !ce.retried) {
          ce.retried = true
          const client = clientRef.current
          if (client) {
            setBusy(sid, true) // a fresh (auto-export) turn begins
            const directive =
              "You built the model but did not export it, so the 3D viewer beside the chat is still empty. " +
              "Call the cad-build123d_export tool NOW with format 'step' and object_name '*' to emit the assembly — " +
              "Nightjar converts that STEP into the 3D model shown in the viewer. Do NOT call render_view (its PNG " +
              "is not visible to the user); call export and nothing else."
            client.promptAsync(sid, directive, ce.agent, ce.model).catch((err) => {
              setBusy(sid, false)
              refs.cadExport = undefined
              setStatus(`cad auto-export failed: ${err?.message ?? err}`)
            })
          } else {
            refs.cadExport = undefined
          }
        } else if (ce.sawBuild) {
          // built + already retried but still no export → surface a non-silent hint.
          refs.cadExport = undefined
          updateMessages(sid, (prev) => [
            ...prev,
            {
              id: `cad-noexport-${Date.now()}`,
              role: "assistant",
              blocks: [{ kind: "text", text: "I built the model but couldn't export it to the 3D viewer — ask me to export it as STEP, or use Load demo." }],
            },
          ])
        } else {
          refs.cadExport = undefined // no build this turn (plain chat) → nothing to export
        }
        // Honesty guardrail (false-success): if the assistant CLAIMS it saved a file but this
        // turn produced no completed write/edit AND no previewable artifact (canvas-from-message),
        // that claim would otherwise be the only thing the user sees — a hallucinated write tool
        // can leave no error card at all. Correct it, non-silently. CHAT SLOT ONLY: the wording
        // is Chat-specific (the assistant has no write tool); Code's truncated-write case is
        // covered by the ToolCallCard isTruncatedWrite hint, and firing "can't save from Chat"
        // on Code would mislead (Bugbot). Idempotent (deterministic id) + self-limiting.
        // 5b: fires for a PROJECT chat too (isChatScope), since it is equally a write-tool-less
        // assistant chat — a project chat's hallucinated-save claim must still be corrected.
        if (isChatScope(sid)) {
          updateMessages(sid, (prev) => {
            // Skip messages THIS handler may have appended earlier (imgfail / cad-noexport / a
            // prior warn), so a synthetic message never masks the real reply's claim (Bugbot).
            const synthetic = (id: string) => /^(local-imgfail-|cad-noexport-|save-warn-)/.test(id)
            const lastA = [...prev].reverse().find((m) => m.role === "assistant" && !synthetic(m.id))
            if (!lastA) return prev
            const warnId = `save-warn-${lastA.id}`
            if (prev.some((m) => m.id === warnId)) return prev
            if (!claimsFileButNoneWritten(lastA)) return prev
            return [
              ...prev,
              {
                id: warnId,
                role: "assistant",
                blocks: [
                  {
                    kind: "text",
                    text: "⚠ No file was actually written — I can't save files to disk from Chat. Ask me to include the file's contents and I'll show it here with a Download button.",
                  },
                ],
              },
            ]
          })
        }
        break
      }
      case "session.error": {
        setBusy(sid, false)
        refs.imageGen = undefined // an errored/aborted turn must not fire the clean-idle image retry (NJ-7)
        refs.cadExport = undefined // ditto — an errored cad turn must not fire the auto-export
        const name: string | undefined = p.error?.name
        setStatus(`error: ${name ?? p.error ?? "unknown"}`)
        handleSessionError(p.error, refs.lastSent, refs.lastKind, refs.lastModel, sid, slotOf(sid))
        break
      }
    }
  })

  // ---- session lifecycle ----
  // chat slot ← ConnectionContext's primary session (adopt on first connect + follow the primary
  // on reconnect, carrying the transcript over) — UNLESS the user has taken manual control of the
  // chat slot via the recents rail, in which case their chosen chat must survive a (re)connect (Bugbot).
  useEffect(() => {
    if (!primaryId) return
    if (chatBoundManually.current) return
    rebindSlot("chat", primaryId, true)
  }, [primaryId, rebindSlot])

  // Chat is a history slot now: mark whatever session the chat slot currently holds — the
  // adopted primary (not marked anywhere else), a New chat, or a resumed one — so it shows in
  // the Chat recents rail. Idempotent (Set) + persisted; covers the reconnect-adopt case that
  // newSession/resumeSession don't.
  useEffect(() => {
    if (isHistorySlot("chat") && slots.chat) markSlotSession("chat", slots.chat)
  }, [slots.chat, markSlotSession])


  // code slot ← created here; (re)created whenever the primary reconnects.
  useEffect(() => {
    if (!primaryId) return
    const client = clientRef.current
    if (!client) return
    let cancelled = false
    ;(async () => {
      for (;;) {
        if (cancelled) return
        try {
          // B3: reap the prior code session on reconnect if it was never used —
          // otherwise every reconnect (BYOK change, SSE drop, crash-restart) leaves an
          // empty "June coding" session behind, cluttering the Code list and growing
          // nightjar.codeSessionIds without bound.
          const prevCodeId = slotsRef.current.code
          const codeId = await client.createSession(DEFAULT_TITLE.code)
          if (!cancelled) {
            // Decide reapability AFTER the await (Bugbot: a pre-await snapshot goes
            // stale) and BEFORE rebind (which gc's the old id): the user may have sent
            // on the code slot during the createSession round-trip. Reap only if the
            // prior session is still present, empty, and not mid-turn — any real /
            // in-flight conversation is carried into the new session and kept.
            // sessionsRef (messages/busy) is refreshed by a passive effect, so it can
            // lag a send by one flush; perSessionRefs.lastSent is set SYNCHRONOUSLY by
            // send()/createImage(), so it closes that residual window with no lag.
            const prev = prevCodeId ? sessionsRef.current[prevCodeId] : undefined
            const prevSent = !!(prevCodeId && perSessionRefs.current.get(prevCodeId)?.lastSent)
            const prevReapable = !!prev && prev.messages.length === 0 && !prev.busy && !prevSent
            rebindSlot("code", codeId, true) // carries the old transcript into the new session
            markSlotSession("code", codeId)
            if (prevCodeId && prevCodeId !== codeId && prevReapable) {
              unmarkSlotSession("code", prevCodeId)
              client.deleteSession(prevCodeId).catch(() => {})
            }
          }
          return
        } catch {
          await sleep(1500)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [primaryId, clientRef, rebindSlot, markSlotSession, unmarkSlotSession])

  // cad slot ← created here on connect, recreated on reconnect (Task 5). The cad slot now
  // has a resumable history rail too (LAB → Mechanical), so it mirrors the code slot: mark
  // each new cad session, and reap the prior one on reconnect if it was never used — else
  // every reconnect leaves an empty "June CAD" session cluttering the Mechanical history.
  // Any real conversation is carried into the new session and kept in the list.
  useEffect(() => {
    if (!primaryId) return
    const client = clientRef.current
    if (!client) return
    let cancelled = false
    ;(async () => {
      for (;;) {
        if (cancelled) return
        try {
          const prevCadId = slotsRef.current.cad
          const cadId = await client.createSession(DEFAULT_TITLE.cad)
          if (!cancelled) {
            // Decide reapability AFTER the await and BEFORE rebind (which gc's the old id),
            // mirroring the code slot's B3 reap: reap only if the prior session is still
            // present, empty, and not mid-turn (perSessionRefs.lastSent closes the flush lag).
            const prev = prevCadId ? sessionsRef.current[prevCadId] : undefined
            const prevSent = !!(prevCadId && perSessionRefs.current.get(prevCadId)?.lastSent)
            const prevReapable = !!prev && prev.messages.length === 0 && !prev.busy && !prevSent
            rebindSlot("cad", cadId, true) // carries the old transcript into the new session
            markSlotSession("cad", cadId)
            if (prevCadId && prevCadId !== cadId && prevReapable) {
              unmarkSlotSession("cad", prevCadId)
              client.deleteSession(prevCadId).catch(() => {})
            }
          }
          return
        } catch {
          await sleep(1500)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [primaryId, clientRef, rebindSlot, markSlotSession, unmarkSlotSession])

  // CAD (Task 5): watch the cad session's MESSAGES (not live SSE) for a completed export tool
  // call, then convert its STEP → GLB and hand the bytes to the viewer. Watching messages —
  // which include the transcript carried across a reconnect — means an export that completed
  // during a reconnect is still picked up (Bugbot). Dedup by callID via a component-level ref
  // (survives rebind); a generation guard makes the latest export win under concurrency.
  const cadSid = slots.cad
  const cadMessages = cadSid ? sessions[cadSid]?.messages : undefined
  useEffect(() => {
    if (!cadMessages) return
    for (const m of cadMessages) {
      for (const b of m.blocks) {
        if (b.kind !== "tool") continue
        const call = b.call
        if (
          call.status !== "completed" ||
          !call.output ||
          !/build123d_export/i.test(call.tool) ||
          processedExportsRef.current.has(call.callID) || // already shown / errored
          convertingExportsRef.current.has(call.callID) // in flight — don't double-convert
        )
          continue
        // export() outputs "Exported to <path>.step<suffix>" (single) OR "Exported to:\n
        // <path>.step\n…" (multi/list). Match both: optional colon, any whitespace incl. the
        // newline, then the first token ending in .step (stop before the volume/bbox suffix).
        const path = /Exported to:?\s*(\S[^\n]*?\.step)\b/i.exec(call.output)?.[1]
        if (!path) continue
        convertingExportsRef.current.add(call.callID)
        const gen = ++cadGenRef.current
        setCadBusy(true)
        setCadError(null)
        cad
          .buildModel(path)
          .then((res) => {
            convertingExportsRef.current.delete(call.callID)
            // Superseded by a newer convert (another export, or a Load-demo click): drop this
            // result but leave the export re-eligible so it can re-surface if the newer one
            // fails and the watcher re-runs.
            if (gen !== cadGenRef.current) return
            processedExportsRef.current.add(call.callID) // terminal for this export
            if ("error" in res) setCadError(res.error)
            else setCadModel({ glb: res.glb, parts: res.parts })
          })
          .catch((e) => {
            convertingExportsRef.current.delete(call.callID)
            if (gen !== cadGenRef.current) return
            processedExportsRef.current.add(call.callID)
            setCadError(e instanceof Error ? e.message : String(e))
          })
          .finally(() => {
            if (gen === cadGenRef.current) setCadBusy(false)
          })
      }
    }
  }, [cadMessages, cadRetryTick])

  // Validate every session's agent against the live agent list (Bugbot: default
  // agent init removed + the ported #21 mode-revalidation). DEFAULT_AGENT
  // ("assistant"/"coding") may be absent from listAgents, and a reconnect can
  // change the list — a session whose agent is not a real agent would POST
  // prompts to a non-existent mode. Keep a still-valid agent; otherwise fall back
  // to assistant / the first available agent.
  useEffect(() => {
    if (agents.length === 0) return
    const names = new Set(agents.map((a) => a.name))
    const fallback = agents.find((a) => a.name === "assistant")?.name ?? agents[0]?.name ?? ""
    setSessions((prev) => {
      let changed = false
      const next = { ...prev }
      for (const id of Object.keys(next)) {
        if (!names.has(next[id].agent)) {
          next[id] = { ...next[id], agent: fallback }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [agents])

  // ---- actions ----
  const send = useCallback(
    (sessionId: string, text: string, opts?: { agent?: string; attachments?: Attachment[]; model?: string; system?: string }) => {
      const client = clientRef.current
      const session = sessionsRef.current[sessionId]
      const refs = perSessionRefs.current.get(sessionId)
      if (!client || !session || !refs) return
      const agent = opts?.agent ?? session.agent
      if (!agent) return
      const atts = opts?.attachments ?? []
      setFallbackOffer(null)
      setRateLimitOffer(null)
      const uid = `local-${Date.now()}`
      // Optimistic render: text + attachment previews.
      const blocks: UiBlock[] = []
      if (text) blocks.push({ kind: "text", text })
      for (const a of atts) {
        if (a.isImage) blocks.push({ kind: "image", src: a.dataUrl, name: a.name })
        else blocks.push({ kind: "file", name: a.name, mime: a.mime, size: a.size })
      }
      if (blocks.length === 0) blocks.push({ kind: "text", text: "" })
      updateMessages(sessionId, (prev) => [...prev, { id: uid, role: "user", blocks }])
      setBusy(sessionId, true)
      refs.lastSent = text
      const model = opts?.model ?? activeModel
      refs.lastKind = "chat"
      refs.lastModel = model
      refs.imageGen = undefined // a plain chat send supersedes any pending image retry (NJ-7)
      // CAD: arm the auto-export watcher for a build turn on the cad agent; a non-cad send clears it.
      refs.cadExport = agent === "cad" ? { agent, model, sawBuild: false, sawExport: false, retried: false } : undefined
      const files: FilePart[] = atts.map((a) => ({ mime: a.mime, url: a.dataUrl, filename: a.name }))
      const imgPaths = atts.filter((a) => a.isImage && a.path).map((a) => a.path as string)
      const promptText = imgPaths.length
        ? `${text ? text + "\n\n" : ""}[The user attached ${imgPaths.length} image${imgPaths.length > 1 ? "s" : ""} at: ${imgPaths.join(", ")}. If you can see the image(s) directly, use them; otherwise call the analyze_image tool with the path to describe each.]`
        : text
      // 5b PR-C: `opts.system` carries a PROJECT chat's Instructions as system context. The CALLER
      // (ProjectChat) computes it from the SAME live state that drives the consent banner + gate, so
      // what the user SEES is exactly what's sent — clearing the Instructions withholds them even if
      // the storage write hasn't landed (no live-vs-storage split-brain — Bugbot). General/Code/CAD
      // pass nothing. Recovery retries also pass nothing, which is the safe direction (never egress).
      client.promptAsync(sessionId, promptText, agent, model, files, opts?.system).catch((err) => {
        setBusy(sessionId, false)
        setStatus(`send failed: ${err?.message ?? err}`)
        if (!isLocalModel(model)) setFallbackOffer({ text, kind: "chat", sessionId, slot: slotOf(sessionId) })
      })
    },
    [activeModel, clientRef, setStatus, setFallbackOffer, setRateLimitOffer, updateMessages, setBusy],
  )

  const createImage = useCallback(
    (sessionId: string, prompt: string, opts?: { model?: string }) => {
      const client = clientRef.current
      const refs = perSessionRefs.current.get(sessionId)
      if (!client || !refs) return
      const imgAgent = agents.some((a) => a.name === "assistant") ? "assistant" : sessionsRef.current[sessionId]?.agent
      if (!imgAgent) return
      setSessionAgent(sessionId, imgAgent)
      setFallbackOffer(null)
      setRateLimitOffer(null)
      const uid = `local-${Date.now()}`
      updateMessages(sessionId, (prev) => [...prev, { id: uid, role: "user", blocks: [{ kind: "text", text: `🎨 Create image: ${prompt}` }] }])
      setBusy(sessionId, true)
      refs.lastSent = prompt
      const model = opts?.model ?? activeModel
      refs.lastKind = "image" // NJ-9: a failed image turn must retry via createImage (re-wraps the directive)
      refs.lastModel = model
      // NJ-7: arm the "did the model actually call generate_image?" retry-once tracker.
      refs.imageGen = { prompt, agent: imgAgent, model, retried: false, sawTool: false }
      const directive = `Use the generate_image tool to create an image now. Image description: "${prompt}". Call the tool immediately; do not ask follow-up questions.`
      client.promptAsync(sessionId, directive, imgAgent, model).catch((err) => {
        setBusy(sessionId, false)
        refs.imageGen = undefined // the initial dispatch failed → disarm the retry-once (Bugbot)
        setStatus(`create image failed: ${err?.message ?? err}`)
        // Parity with send(): a synchronous cloud reject should also surface a local-
        // retry offer — as an IMAGE (kind), so the retry re-wraps the directive rather
        // than resending the raw prompt as chat. (The SSE session.error path is already
        // covered via handleSessionError with refs.lastKind="image".)
        if (!isLocalModel(model)) setFallbackOffer({ text: prompt, kind: "image", sessionId, slot: slotOf(sessionId) })
      })
    },
    [agents, activeModel, clientRef, setSessionAgent, setStatus, setFallbackOffer, setRateLimitOffer, updateMessages, setBusy],
  )

  // Where a recovery retry should land: prefer the slot's CURRENT session (so it
  // survives a reconnect that replaced the id — Bugbot #1), else the original
  // session if it's still alive, else "" (caller surfaces it — never a silent drop).
  const retryTarget = useCallback((offer: { sessionId: string; slot: string | null }): string => {
    const bySlot = offer.slot ? slotsRef.current[offer.slot as SlotId] : ""
    if (bySlot && sessionsRef.current[bySlot]) return bySlot
    if (sessionsRef.current[offer.sessionId]) return offer.sessionId
    return ""
  }, [])

  // Retry on the local model after a cloud failure — into the SESSION/slot that
  // failed, resolving a reconnect-replaced id via the slot's current session.
  const fallbackToLocal = useCallback(() => {
    const offer = fallbackOffer
    setFallbackOffer(null)
    setActiveModel(LOCAL_MODEL.id)
    if (!offer) return
    const target = retryTarget(offer)
    if (!target) {
      setStatus("Couldn't retry — that conversation has ended.")
      return
    }
    // NJ-9: an image retry MUST go through createImage (re-wraps the generate_image
    // directive) — a plain send of the raw prompt would just chat about it.
    if (offer.kind === "image") createImage(target, offer.text, { model: LOCAL_MODEL.id })
    else send(target, offer.text, { model: LOCAL_MODEL.id })
  }, [fallbackOffer, setFallbackOffer, setActiveModel, send, createImage, retryTarget, setStatus])

  // Accept the 429 switch: move to the free OpenRouter model (persists for the
  // session) and resend the failing session's last prompt (same slot resolution).
  const acceptOpenRouterSwitch = useCallback(() => {
    const offer = rateLimitOffer
    setRateLimitOffer(null)
    setActiveModel(OPENROUTER_FREE_CHOICE.id)
    if (!offer) return
    const target = retryTarget(offer)
    if (!target) {
      setStatus("Couldn't retry — that conversation has ended.")
      return
    }
    if (offer.kind === "image") createImage(target, offer.text, { model: OPENROUTER_FREE_CHOICE.id })
    else send(target, offer.text, { model: OPENROUTER_FREE_CHOICE.id })
  }, [rateLimitOffer, setRateLimitOffer, setActiveModel, send, createImage, retryTarget, setStatus])

  // ---- session-history list (Code tab) ----
  const listSessions = useCallback(async () => {
    const client = clientRef.current
    if (!client) return []
    try {
      return await client.listSessions()
    } catch {
      return []
    }
  }, [clientRef])

  const resumeSession = useCallback(
    async (slot: SlotId, sessionId: string, agent: string, title?: string) => {
      const client = clientRef.current
      if (!client) return
      if (slotsRef.current[slot] === sessionId) return // already on it
      let messages: UiMessage[] = []
      try {
        messages = messagesFromHistory(await client.getMessages(sessionId))
      } catch {
        /* engine has no history → empty (still switch to the live session) */
      }
      // A Move OUT of General that landed while getMessages ran means this General resume is stale —
      // committing it would re-bind + re-mark (markSlotSession) a chat the user has moved away. Only
      // the chat slot resumes into General; code/cad are never move sources, so this never fires for
      // them (movedOutOfRef only ever holds chat ids). (Bugbot.)
      if (slot === "chat" && movedOutOf(sessionId, { kind: "general" })) return
      perSessionRefs.current.set(sessionId, freshRefs())
      // Prefer the title the caller already has from the session list (so the
      // Code toolbar shows the real name, not the generic DEFAULT_TITLE); fall
      // back to any prior state for this id, then the slot default.
      setSessions((prev) => ({
        ...prev,
        [sessionId]: { id: sessionId, agent: validAgent(agent), title: title || prev[sessionId]?.title || DEFAULT_TITLE[slot], messages, busy: false },
      }))
      slotsRef.current = { ...slotsRef.current, [slot]: sessionId }
      setSlots((prev) => ({ ...prev, [slot]: sessionId }))
      if (isHistorySlot(slot)) markSlotSession(slot, sessionId) // remember it in this slot's history
      if (slot === "chat") chatBoundManually.current = true // resuming a chat is a manual choice — survive (re)connect
      gcSessions() // forget the previous slot session (unless another slot uses it)
    },
    [clientRef, gcSessions, validAgent, markSlotSession, movedOutOf],
  )

  const newSession = useCallback(
    async (slot: SlotId, agent: string) => {
      const client = clientRef.current
      if (!client) return
      let id: string
      try {
        // Created WITHOUT a forced title so the engine auto-titles from the conversation (OpenCode's
        // ensureTitle only fires while the title is still its own default; a forced title suppresses
        // it). Applies to code/cad too now, so their rails show distinct names instead of every
        // session reading the same "June coding"/"June CAD" (consistency sweep).
        id = await client.createSession()
      } catch (err: any) {
        // Guard the create like resume/delete already do (P3-7): a network/timeout failure here
        // must surface, not silently no-op the "new session" button (leaving the slot on its old id).
        setStatus(`couldn't start a new session: ${err?.message ?? err}`)
        return
      }
      rebindSlot(slot, id, false) // fresh session → do not carry the old transcript
      setSessionAgent(id, validAgent(agent))
      if (isHistorySlot(slot)) markSlotSession(slot, id) // remember it in this slot's history
      if (slot === "chat") chatBoundManually.current = true // a New chat is a manual choice — don't re-adopt over it
    },
    [clientRef, rebindSlot, setSessionAgent, validAgent, markSlotSession, setStatus],
  )

  // 5b — bind a resolved session id as a project's ACTIVE chat: register it, set active state, and
  // record it in the project's history. Shared by open/new/resume. Reaps the previously-active
  // chat via gcSessions (it's no longer referenced) unless another slot/project still holds it.
  const bindProjectChat = useCallback(
    (projectId: string, id: string, messages: UiMessage[]) => {
      // Don't bind a project/chat deleted mid-resolve, nor a chat moved OUT of this project by a Move
      // that landed while this open/resume was in flight (movedOutOfRef) — that would re-activate it
      // on the rail it just left, alongside its new home.
      if (deletedProjectsRef.current.has(projectId) || deletedChatsRef.current.has(id) || movedOutOf(id, { kind: "project", projectId })) return
      markProjectChat(projectId, id)
      const prevActive = projectChatsRef.current[projectId]
      if (prevActive === id) {
        // Already the active chat — but a re-fetch (recovery after a failed history load, or a
        // resume of the current chat) still needs to refresh the transcript. Only apply a NON-empty
        // fetch, so the reconnect path (which binds with messages=[] to preserve the live state)
        // never wipes it. (Bugbot.)
        if (messages.length) setSessions((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], messages } } : prev))
        return
      }
      projectChatsRef.current = { ...projectChatsRef.current, [projectId]: id }
      perSessionRefs.current.set(id, freshRefs())
      setProjectChats((prev) => ({ ...prev, [projectId]: id }))
      setSessions((prev) => ({
        ...prev,
        [id]: { id, agent: validAgent(DEFAULT_AGENT.chat), title: prev[id]?.title ?? "", messages, busy: false },
      }))
      if (prevActive && prevActive !== id) gcSessions() // switched away → reap the old active chat
    },
    [validAgent, markProjectChat, gcSessions, movedOutOf],
  )

  // 5b — resolve a project's ACTIVE chat when its view opens. If one is already bound, return it (it
  // persists across reconnects, so no revalidation is needed). Otherwise hydrate the rail's history
  // into state IMMEDIATELY (so saved chats show during the async open — Bugbot), then resume the
  // NEWEST saved chat, or create a fresh one if there are none. No proactive liveness check: sessions
  // persist in the engine DB, so a resumed chat is almost always alive; getMessages returns empty if
  // it isn't and a send would surface the error for the user to recover with New chat. Only the
  // active chat is a loaded session; the rest are rail ids.
  const openProjectChat = useCallback(
    async (projectId: string): Promise<string> => {
      if (!projectId) return ""
      const bound = projectChatsRef.current[projectId]
      if (bound) return bound
      // Hydrate the persisted history into state up front so the rail isn't empty during the open.
      const history = projectChatIdsRef.current[projectId] ?? loadProjectChatIds(projectId)
      if (!(projectId in projectChatIdsRef.current) && history.length && !deletedProjectsRef.current.has(projectId)) {
        projectChatIdsRef.current = { ...projectChatIdsRef.current, [projectId]: history }
        setProjectChatIds((prev) => ({ ...prev, [projectId]: history }))
      }
      const inflight = projectChatOpening.current.get(projectId)
      if (inflight) return inflight
      const client = clientRef.current
      if (!client) return ""
      const run = (async (): Promise<string> => {
        // Capture the selection counter (openProjectChat only OBSERVES it — new/resume bump it): if a
        // concurrent ＋New/resume runs while we resolve, this changes and we defer, so the auto-open
        // doesn't leave an extra chat alongside the user's explicit one (consistency sweep — mirrors
        // the new/resume guard).
        const seq = projectSelectSeq.current[projectId] ?? 0
        const newest = history[0] || null
        let id = ""
        let messages: UiMessage[] = []
        if (newest) {
          id = newest
          try {
            messages = messagesFromHistory(await client.getMessages(newest))
          } catch {
            /* dead/empty → bind with no messages; a send surfaces the error to recover from */
          }
        } else {
          try {
            id = await client.createSession() // no forced title → engine auto-titles after the 1st message
          } catch (err: any) {
            setStatus(`couldn't start the project chat: ${err?.message ?? err}`)
            return ""
          }
        }
        // Deleted mid-resolve, a concurrent selection bumped the counter, or a different active was
        // set while we resolved → defer; reap a session we CREATED (not a resumed one) that nobody
        // will use.
        const supersededBySelection = (projectSelectSeq.current[projectId] ?? 0) !== seq
        if (deletedProjectsRef.current.has(projectId) || supersededBySelection) {
          if (id && !newest) client.deleteSession(id).catch(() => {})
          return projectChatsRef.current[projectId] || ""
        }
        const active = projectChatsRef.current[projectId]
        if (active) {
          if (id && !newest && id !== active) client.deleteSession(id).catch(() => {})
          return active
        }
        bindProjectChat(projectId, id, messages)
        return id
      })()
      projectChatOpening.current.set(projectId, run)
      try {
        return await run
      } finally {
        if (projectChatOpening.current.get(projectId) === run) projectChatOpening.current.delete(projectId)
      }
    },
    [clientRef, setStatus, bindProjectChat],
  )

  // 5b — start a NEW chat in a project (the rail's ＋). Fresh session, engine auto-titled, becomes
  // the active chat and the newest history entry.
  const newProjectChat = useCallback(
    async (projectId: string): Promise<string> => {
      if (!projectId) return ""
      const client = clientRef.current
      if (!client) return ""
      const seq = nextSelectSeq(projectId)
      let id: string
      try {
        id = await client.createSession() // no forced title → engine auto-titles
      } catch (err: any) {
        setStatus(`couldn't start a new chat: ${err?.message ?? err}`)
        return ""
      }
      // Superseded by a newer selection, or the project was deleted, while createSession ran → reap
      // the fresh engine session so it doesn't orphan (Bugbot), and don't bind.
      if (projectSelectSeq.current[projectId] !== seq || deletedProjectsRef.current.has(projectId)) {
        client.deleteSession(id).catch(() => {})
        return ""
      }
      bindProjectChat(projectId, id, [])
      return id
    },
    [clientRef, setStatus, bindProjectChat, nextSelectSeq],
  )

  // 5b — resume an existing chat from a project's rail: load its transcript and make it active. No
  // liveness pre-check (sessions persist); getMessages returns empty if the id is gone. Deliberately
  // NOT early-returning when the id is already active — re-clicking re-fetches, which is the recovery
  // path after a first load came back empty. bindProjectChat only overwrites the transcript on a
  // NON-empty fetch, so this never wipes a live conversation. (Bugbot.)
  const resumeProjectChat = useCallback(
    async (projectId: string, sessionId: string): Promise<void> => {
      if (!projectId || !sessionId) return
      // Re-clicking the ALREADY-ACTIVE chat: no-op WHILE it is streaming, so a re-fetched history
      // snapshot can't replace the transcript and drop the in-flight assistant reply arriving over
      // SSE (Bugbot). When idle, fall through and re-fetch — the recovery path for a chat that first
      // loaded empty. (busy lags a send by a flush, so also treat a synchronously-set lastSent as
      // busy, mirroring gcSessions.)
      const active = projectChatsRef.current[projectId] === sessionId
      const streaming = sessionsRef.current[sessionId]?.busy || !!perSessionRefs.current.get(sessionId)?.lastSent
      if (active && streaming) return
      const client = clientRef.current
      if (!client) return
      const seq = nextSelectSeq(projectId)
      let messages: UiMessage[] = []
      try {
        messages = messagesFromHistory(await client.getMessages(sessionId))
      } catch {
        /* dead/empty → bind with no messages */
      }
      // A newer rail click / ＋New superseded this resume while getMessages ran → drop it, so the
      // last click wins rather than the last fetch to finish (Bugbot).
      if (projectSelectSeq.current[projectId] !== seq) return
      bindProjectChat(projectId, sessionId, messages)
    },
    [clientRef, bindProjectChat, nextSelectSeq],
  )

  // 5b — remove ALL of a project's chats when the project is deleted (decision #3: best-effort
  // engine delete so a deleted project's transcripts don't linger server-side). Ids are captured
  // synchronously up front, before the projects store's purge clears the persisted history key.
  const deleteProjectChat = useCallback(
    async (projectId: string) => {
      // Mark deleted SYNCHRONOUSLY, before any await and before the store's purge — every
      // project-chat write path checks this, so an openProjectChat still in flight can't
      // resurrect this project's state or re-persist its keys after the purge (Bugbot).
      deletedProjectsRef.current.add(projectId)
      const active = projectChatsRef.current[projectId]
      const history = projectChatIdsRef.current[projectId] ?? loadProjectChatIds(projectId) // sync capture
      projectChatOpening.current.delete(projectId)
      projectChatsRef.current = Object.fromEntries(Object.entries(projectChatsRef.current).filter(([k]) => k !== projectId))
      projectChatIdsRef.current = Object.fromEntries(Object.entries(projectChatIdsRef.current).filter(([k]) => k !== projectId))
      setProjectChats((prev) => {
        const next = { ...prev }
        delete next[projectId]
        return next
      })
      setProjectChatIds((prev) => {
        const next = { ...prev }
        delete next[projectId]
        return next
      })
      const client = clientRef.current
      for (const sid of new Set([active, ...history].filter(Boolean) as string[])) {
        if (client) await client.deleteSession(sid).catch(() => {})
      }
      gcSessions()
    },
    [clientRef, gcSessions],
  )

  // Chat menu — delete a SINGLE chat from a project's rail (vs deleteProjectChat, which drops the
  // whole project). Removes it from the history list + engine, and if it was the active chat,
  // switches to the newest remaining one (or starts a fresh chat if none are left) so the view is
  // never left on a dead id.
  const deleteProjectChatOne = useCallback(
    async (projectId: string, sessionId: string) => {
      if (!projectId || !sessionId) return
      // Mark deleted SYNCHRONOUSLY so an openProjectChat still resolving this id can't bind/re-add
      // it (its bind/mark now no-op — Bugbot).
      deletedChatsRef.current.add(sessionId)
      const cur = projectChatIdsRef.current[projectId] ?? loadProjectChatIds(projectId)
      const next = cur.filter((x) => x !== sessionId)
      projectChatIdsRef.current = { ...projectChatIdsRef.current, [projectId]: next }
      saveProjectChatIds(projectId, next)
      setProjectChatIds((prev) => ({ ...prev, [projectId]: next }))
      const wasActive = projectChatsRef.current[projectId] === sessionId
      // Switch to a replacement BEFORE deleting the engine session and WITHOUT clearing the active
      // binding first — resume/new's bindProjectChat reaps the old active in-memory as it switches.
      // Awaiting here (not `void`) means the view goes straight from the old chat to the new one,
      // never flashing the "couldn't open" state through an empty-active gap (Bugbot). The
      // `!active` case covers deleting the very chat an in-flight openProjectChat was about to bind
      // (that bind now no-ops), which would otherwise leave the project chatless.
      if (wasActive || !projectChatsRef.current[projectId]) {
        if (next[0]) await resumeProjectChat(projectId, next[0])
        else await newProjectChat(projectId)
      }
      // The replacement can NO-OP (superseded by a concurrent selection, no client, or a failed
      // create). If it didn't take and we're still on the deleted id, clear the binding so the view
      // isn't left on a removed session — a concurrent selection that DID win leaves a different
      // active, which we must not clobber, hence the exact-id check (Bugbot).
      if (projectChatsRef.current[projectId] === sessionId) {
        projectChatsRef.current = Object.fromEntries(Object.entries(projectChatsRef.current).filter(([k]) => k !== projectId))
        setProjectChats((prev) => {
          const n = { ...prev }
          delete n[projectId]
          return n
        })
      }
      const client = clientRef.current
      if (client) await client.deleteSession(sessionId).catch(() => {})
      gcSessions()
    },
    [clientRef, gcSessions, resumeProjectChat, newProjectChat],
  )

  // Chat menu (PR-2) — re-file a chat between scopes (General ↔ project, project ↔ project). The
  // transcript stays in the engine under the SAME session id; only which client-side id-list owns
  // the chat changes, so this is pure list surgery — no engine delete, and the moved id is NEVER
  // added to deletedChatsRef (it must stay bindable in its new home). Pins are the RAIL's concern:
  // SessionList unpins the source only when this RESOLVES TRUE (a real move happened) — an aborted
  // move must not silently unpin (decision: a pin is a per-rail position hint, not carried across a
  // re-file). If the moved chat was the source's ACTIVE chat, the source resolves a replacement
  // (newest remaining → else fresh), mirroring deleteProjectChatOne minus the delete, so the source
  // view is never stranded. Returns whether a move actually happened.
  const moveChatToScope = useCallback(
    async (sessionId: string, from: ChatMoveScope, to: ChatMoveScope): Promise<boolean> => {
      if (!sessionId || sameChatScope(from, to)) return false
      // Can't file into a project that's been deleted this session (markProjectChat would no-op,
      // orphaning the chat off every rail while it lives on in the engine). The picker shouldn't list
      // a deleted project, but it can be deleted between menu-open and click — abort cleanly (Bugbot).
      if (to.kind === "project" && deletedProjectsRef.current.has(to.projectId)) return false
      // Mark the source scope SYNCHRONOUSLY, before any await, so an in-flight open/resume that
      // resolves during the detach can't revive the chat on the rail it's leaving (see movedOutOfRef).
      movedOutOfRef.current.set(sessionId, from)

      // ── 1. Detach from the SOURCE rail (drop from its id-list), replacing it if it was active ──
      if (from.kind === "project") {
        const pid = from.projectId
        const cur = projectChatIdsRef.current[pid] ?? loadProjectChatIds(pid)
        const next = cur.filter((x) => x !== sessionId)
        projectChatIdsRef.current = { ...projectChatIdsRef.current, [pid]: next }
        saveProjectChatIds(pid, next)
        setProjectChatIds((prev) => ({ ...prev, [pid]: next }))
        // Replace if the moved chat was the active one OR the project has no active binding yet — the
        // latter covers moving the chat an in-flight openProjectChat was about to bind (that bind now
        // no-ops via movedOutOfRef), which would otherwise leave the project chatless. Mirrors
        // deleteProjectChatOne's condition exactly, minus the engine delete (Bugbot).
        if (projectChatsRef.current[pid] === sessionId || !projectChatsRef.current[pid]) {
          if (next[0]) await resumeProjectChat(pid, next[0])
          else await newProjectChat(pid)
          // The replacement can no-op (superseded / no client / failed create). If we're still on the
          // moved id, clear the binding so the source view isn't left on a chat it no longer owns.
          if (projectChatsRef.current[pid] === sessionId) {
            projectChatsRef.current = Object.fromEntries(Object.entries(projectChatsRef.current).filter(([k]) => k !== pid))
            setProjectChats((prev) => {
              const n = { ...prev }
              delete n[pid]
              return n
            })
          }
        }
      } else {
        // The General chat slot is the adopted primary, so a MOVED-active chat must end up on a
        // DIFFERENT session or the slots.chat effect just re-marks it back into the General rail.
        // Secure a fresh replacement chat (matches ＋ New chat) BEFORE detaching: if createSession
        // fails (no client / engine error mid-move), newSession leaves slots.chat unchanged and
        // surfaces its own error, so we ABORT — clearing the source mark so the un-moved chat isn't
        // left wrongly blocked from its own rail — and report no move. A non-active General chat has
        // no such coupling and re-tags directly below. (Bugbot.)
        if (slotsRef.current.chat === sessionId) {
          await newSession("chat", "assistant")
          if (slotsRef.current.chat === sessionId) {
            movedOutOfRef.current.delete(sessionId)
            return false
          }
        }
        unmarkSlotSession("chat", sessionId) // drop from the General rail's id set
      }

      // ── 2. Attach to the TARGET rail (history/list only — does NOT auto-open the moved chat) ──
      if (to.kind === "project") markProjectChat(to.projectId, sessionId)
      else markSlotSession("chat", sessionId)
      gcSessions() // a moved-away active chat is no longer bound → forget its in-memory session (it persists in the engine)
      return true
    },
    [resumeProjectChat, newProjectChat, newSession, markProjectChat, markSlotSession, unmarkSlotSession, gcSessions],
  )

  // Auto-memory (AM-2b): summarise a project's chats into a memory paragraph. Runs on an EPHEMERAL
  // throwaway session that is NEVER registered in perSessionRefs — so it never demuxes SSE, is never
  // GC'd, never appears in a rail (rails filter to their own id sets), and never surfaces a permission
  // prompt (PermissionContext gates on hasSession, which is false for it). LOCAL model only (decision
  // 2: a whole project's chats must never egress to summarise). The synchronous /message call blocks
  // until the turn finishes (bounded by SYNC_PROMPT_TIMEOUT_MS). The caller stages the result as a
  // proposal for Accept/Discard — this never writes the memory.
  const MAX_MEMORY_CHATS = 20 // cap the chats gathered (newest-first) so gathering stays bounded
  const MAX_TRANSCRIPT_CHARS = 12000 // ~fits the local 4B context alongside the directive; tune live
  const GATHER_DEADLINE_MS = 45000 // overall wall-clock for the multi-call gather phase (rule 3)
  const summarizeProjectChats = useCallback(
    async (
      projectId: string,
      currentMemory: string,
    ): Promise<{ ok: true; summary: string; chatCount: number; coveredCount: number; truncated: boolean } | { ok: false; error: string }> => {
      const client = clientRef.current
      if (!client) return { ok: false, error: "Not connected to the engine." }
      const allIds = projectChatIdsRef.current[projectId] ?? loadProjectChatIds(projectId)
      const chatCount = allIds.length
      if (chatCount === 0) return { ok: false, error: "This project has no chats to summarise yet." }
      // Best-effort title map (cosmetic transcript headers) — captured BEFORE the ephemeral session
      // exists, so it never lists itself.
      const titles = new Map<string, string>()
      try {
        for (const s of await client.listSessions()) titles.set(s.id, s.title ?? "")
      } catch {
        /* titles are cosmetic — proceed without them */
      }
      // Bound the GATHER phase overall (rule 3): each getMessages is individually 15s-bounded, but 20
      // sequential ones could still stack into minutes if the engine is slow. Stop gathering past the
      // deadline and summarise what we have — coveredCount then reflects the shortfall and the UI flags
      // partial coverage (Bugbot). The prompt call is separately bounded by SYNC_PROMPT_TIMEOUT_MS.
      const gatherDeadline = Date.now() + GATHER_DEADLINE_MS
      const transcripts: ChatTranscript[] = []
      for (const id of allIds.slice(0, MAX_MEMORY_CHATS)) {
        if (Date.now() > gatherDeadline) break
        let msgs: MessageWithParts[] = []
        try {
          msgs = await client.getMessages(id)
        } catch {
          continue // skip a dead/unreadable chat rather than fail the whole summary
        }
        // Order by creation time before extracting turns — GET /message is not guaranteed sorted, and
        // a scrambled transcript summarises wrong (mirrors messagesFromHistory's defensive sort — Bugbot).
        const turns = [...msgs]
          .sort((a, b) => (a.info?.time?.created ?? 0) - (b.info?.time?.created ?? 0))
          .map((m) => ({
            role: m.info.role === "user" ? ("user" as const) : ("assistant" as const),
            text: (m.parts ?? [])
              .filter((p: any) => p?.type === "text" && typeof p?.text === "string")
              .map((p: any) => p.text as string)
              .join(" ")
              .trim(),
          }))
          .filter((t) => t.text)
        if (turns.length) transcripts.push({ title: displayChatTitle(titles.get(id)), turns })
      }
      if (!transcripts.length) return { ok: false, error: "Couldn't read any chat content to summarise." }
      const { text: transcriptText, includedChats, truncated } = assembleTranscripts(transcripts, MAX_TRANSCRIPT_CHARS)
      if (!transcriptText.trim()) return { ok: false, error: "The project's chats are too large to summarise — try trimming them." }
      const prompt = buildSummaryPrompt({ transcripts: transcriptText, currentMemory })
      let sid: string
      try {
        sid = await client.createSession("Auto-memory (temp)") // forced title → not auto-titled; deleted below
      } catch (err: any) {
        return { ok: false, error: `couldn't start the summariser: ${err?.message ?? err}` }
      }
      try {
        // Use the "assistant" agent — it's the shipped workspace's general agent (the tools-denied
        // built-in "summary" agent is NOT in opencode.json and may not resolve — Bugbot). Tool use is
        // triple-guarded anyway: the directive says don't call tools, the ephemeral session is never
        // registered so PermissionContext (hasSession gate) can't surface a prompt for it, and the
        // 120s wall-clock bounds any turn that stalls on a would-be permission.
        const summary = (await client.prompt(sid, prompt, validAgent("assistant"), LOCAL_MODEL.id)).trim()
        if (!summary) return { ok: false, error: "The model returned an empty summary — try again." }
        // chatCount = the project's FULL chat count (drives staleness); coveredCount = how many were
        // actually summarised; truncated = whether ANY content was dropped (later chats OR a shortened
        // head of one) — so the UI can flag partial coverage rather than present it as complete, even
        // when every chat is "included" but one was truncated to fit (rule 8 — Bugbot).
        return { ok: true, summary, chatCount, coveredCount: includedChats, truncated }
      } catch (err: any) {
        return { ok: false, error: `summary failed: ${err?.message ?? err}` }
      } finally {
        client.deleteSession(sid).catch(() => {}) // clean teardown regardless of outcome
      }
    },
    [clientRef, validAgent],
  )

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const client = clientRef.current
      if (!client) return
      await client.deleteSession(sessionId).catch(() => {})
      // If a slot is currently on the deleted session, spin up a fresh session
      // for it so the slot never points at a dead id.
      const boundSlots = (Object.keys(slotsRef.current) as SlotId[]).filter((s) => slotsRef.current[s] === sessionId)
      for (const slot of boundSlots) {
        try {
          // No forced title → the engine auto-titles the replacement, matching newSession.
          const fresh = await client.createSession()
          rebindSlot(slot, fresh, false) // fresh → don't carry the deleted transcript
          // Register the replacement in the slot's history, or it vanishes from the rail after the
          // user switches away even though the engine session exists (Bugbot).
          if (isHistorySlot(slot)) markSlotSession(slot, fresh)
        } catch {
          /* leave the slot; gcSessions below still forgets the dead id */
        }
      }
      for (const s of HISTORY_SLOTS) unmarkSlotSession(s, sessionId) // drop from every slot's history registry
      gcSessions() // drop the deleted id from the client-side registry
    },
    [clientRef, rebindSlot, gcSessions, unmarkSlotSession, markSlotSession],
  )

  const renameSession = useCallback(
    async (sessionId: string, title: string) => {
      const client = clientRef.current
      if (!client) return
      await client.renameSession(sessionId, title).catch(() => {})
      setSessions((prev) => (prev[sessionId] ? { ...prev, [sessionId]: { ...prev[sessionId], title } } : prev))
    },
    [clientRef],
  )

  const value: SessionsValue = {
    sessions,
    slots,
    messagesOf,
    busyOf,
    send,
    createImage,
    setSessionAgent,
    listSessions,
    resumeSession,
    newSession,
    deleteSession,
    renameSession,
    projectChats,
    projectChatIds,
    openProjectChat,
    newProjectChat,
    resumeProjectChat,
    deleteProjectChat,
    deleteProjectChatOne,
    moveChatToScope,
    summarizeProjectChats,
    hasSession,
    setBusy,
    sessionIdsBySlot,
    cadModel,
    cadBusy,
    cadError,
    clearCadModel,
    loadCadHero,
    fallbackToLocal,
    acceptOpenRouterSwitch,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
