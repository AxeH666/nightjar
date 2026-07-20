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
const HISTORY_SLOTS: SlotId[] = ["code", "cad"]
const isHistorySlot = (slot: SlotId): boolean => HISTORY_SLOTS.includes(slot)
// The code slot keeps its ORIGINAL key so existing users' history survives the generalization.
function sessionIdsKey(slot: SlotId): string {
  return slot === "code" ? "nightjar.codeSessionIds" : `nightjar.sessionIds.${slot}`
}
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
  send: (sessionId: string, text: string, opts?: { agent?: string; attachments?: Attachment[]; model?: string }) => void
  createImage: (sessionId: string, prompt: string, opts?: { model?: string }) => void
  setSessionAgent: (sessionId: string, agent: string) => void
  // session-history list (Code tab)
  listSessions: () => Promise<SessionInfo[]>
  resumeSession: (slot: SlotId, sessionId: string, agent: string, title?: string) => Promise<void>
  newSession: (slot: SlotId, agent: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
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
    chat: new Set(),
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
    const bound = new Set(Object.values(slotsRef.current).filter(Boolean))
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
        // Honesty guardrail (false-success): if the last assistant message CLAIMS it saved a
        // file but this turn produced no completed write/edit AND no previewable artifact
        // (canvas-from-message), that claim would otherwise be the only thing the user sees —
        // a hallucinated write tool can leave no error card at all. Correct it, non-silently.
        // Idempotent (deterministic id) + self-limiting (the note becomes the last assistant msg).
        updateMessages(sid, (prev) => {
          const lastA = [...prev].reverse().find((m) => m.role === "assistant")
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
  // chat slot ← ConnectionContext's primary session (adopt + rebind on reconnect).
  useEffect(() => {
    if (!primaryId) return
    rebindSlot("chat", primaryId, true)
  }, [primaryId, rebindSlot])

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
    (sessionId: string, text: string, opts?: { agent?: string; attachments?: Attachment[]; model?: string }) => {
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
      client.promptAsync(sessionId, promptText, agent, model, files).catch((err) => {
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
      gcSessions() // forget the previous slot session (unless another slot uses it)
    },
    [clientRef, gcSessions, validAgent, markSlotSession],
  )

  const newSession = useCallback(
    async (slot: SlotId, agent: string) => {
      const client = clientRef.current
      if (!client) return
      let id: string
      try {
        id = await client.createSession(DEFAULT_TITLE[slot])
      } catch (err: any) {
        // Guard the create like resume/delete already do (P3-7): a network/timeout failure here
        // must surface, not silently no-op the "new session" button (leaving the slot on its old id).
        setStatus(`couldn't start a new session: ${err?.message ?? err}`)
        return
      }
      rebindSlot(slot, id, false) // fresh session → do not carry the old transcript
      setSessionAgent(id, validAgent(agent))
      if (isHistorySlot(slot)) markSlotSession(slot, id) // remember it in this slot's history
    },
    [clientRef, rebindSlot, setSessionAgent, validAgent, markSlotSession, setStatus],
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
          const fresh = await client.createSession(DEFAULT_TITLE[slot])
          rebindSlot(slot, fresh, false) // fresh → don't carry the deleted transcript
        } catch {
          /* leave the slot; gcSessions below still forgets the dead id */
        }
      }
      for (const s of HISTORY_SLOTS) unmarkSlotSession(s, sessionId) // drop from every slot's history registry
      gcSessions() // drop the deleted id from the client-side registry
    },
    [clientRef, rebindSlot, gcSessions, unmarkSlotSession],
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
