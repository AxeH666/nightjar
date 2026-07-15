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

// Client-side "kind" tag for sessions. OpenCode has NO per-session kind, so we
// remember which session ids have served as CODE sessions (created or resumed
// into the code slot) and persist that across restarts — the Code tab lists only
// these, never the chat session or unrelated pre-existing histories. localStorage
// is renderer-only and can be unavailable/blocked, so every access is guarded and
// degrades to in-memory-only for the current run.
const CODE_SESSIONS_KEY = "nightjar.codeSessionIds"
function loadCodeSessionIds(): Set<string> {
  try {
    const raw = localStorage.getItem(CODE_SESSIONS_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}
function persistCodeSessionIds(ids: Set<string>): void {
  try {
    localStorage.setItem(CODE_SESSIONS_KEY, JSON.stringify([...ids]))
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
  // code-session kind registry (Code tab list); persisted client-side
  codeSessionIds: Set<string>
  // CAD (Task 5): the current converted model for the viewer + whether a conversion is
  // running. The CAD agent's export tool completing drives these; the CAD screen renders them.
  cadModel: { glb: ArrayBuffer; parts: string[] } | null
  cadBusy: boolean
  cadError: string | null
  clearCadModel: () => void
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
  // Which export tool-calls have already been converted (by callID) — a component-level ref,
  // NOT per-session, so it survives a reconnect's session rebind (Bugbot: a per-session set is
  // gc'd, so an export that completed during a reconnect would never build). And a monotonic
  // generation so, when several exports complete close together, only the latest one's result
  // (and its busy=false) is applied — a slow older convert can't clobber a newer model.
  const processedExportsRef = useRef<Set<string>>(new Set())
  const cadGenRef = useRef(0)
  const clearCadModel = useCallback(() => {
    setCadModel(null)
    setCadError(null)
  }, [])
  // Persisted set of session ids that have served as CODE sessions (see the
  // module-level helpers). The Code tab filters GET /session down to these.
  const [codeSessionIds, setCodeSessionIds] = useState<Set<string>>(loadCodeSessionIds)
  const markCodeSession = useCallback((id: string) => {
    setCodeSessionIds((prev) => {
      if (!id || prev.has(id)) return prev
      const next = new Set(prev).add(id)
      persistCodeSessionIds(next)
      return next
    })
  }, [])
  const unmarkCodeSession = useCallback((id: string) => {
    setCodeSessionIds((prev) => {
      if (!prev.has(id)) return prev
      const next = new Set(prev)
      next.delete(id)
      persistCodeSessionIds(next)
      return next
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
        break
      }
      case "session.error": {
        setBusy(sid, false)
        refs.imageGen = undefined // an errored/aborted turn must not fire the clean-idle image retry (NJ-7)
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
            markCodeSession(codeId)
            if (prevCodeId && prevCodeId !== codeId && prevReapable) {
              unmarkCodeSession(prevCodeId)
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
  }, [primaryId, clientRef, rebindSlot, markCodeSession, unmarkCodeSession])

  // cad slot ← created here on connect, recreated on reconnect (Task 5). Simpler than the
  // code slot: CAD sessions aren't in any history list, so there's no reaping to do — we just
  // carry the transcript into the new session on a reconnect.
  useEffect(() => {
    if (!primaryId) return
    const client = clientRef.current
    if (!client) return
    let cancelled = false
    ;(async () => {
      for (;;) {
        if (cancelled) return
        try {
          const cadId = await client.createSession(DEFAULT_TITLE.cad)
          if (!cancelled) rebindSlot("cad", cadId, true)
          return
        } catch {
          await sleep(1500)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [primaryId, clientRef, rebindSlot])

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
          processedExportsRef.current.has(call.callID)
        )
          continue
        const path = /Exported to (.+?\.step)\b/i.exec(call.output)?.[1]
        if (!path) continue
        processedExportsRef.current.add(call.callID)
        const gen = ++cadGenRef.current
        setCadBusy(true)
        setCadError(null)
        cad
          .buildModel(path)
          .then((res) => {
            if (gen !== cadGenRef.current) return // superseded by a newer export
            if ("error" in res) setCadError(res.error)
            else setCadModel({ glb: res.glb, parts: res.parts })
          })
          .catch((e) => {
            if (gen === cadGenRef.current) setCadError(e instanceof Error ? e.message : String(e))
          })
          .finally(() => {
            if (gen === cadGenRef.current) setCadBusy(false)
          })
      }
    }
  }, [cadMessages])

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
      if (slot === "code") markCodeSession(sessionId) // remember it as a code session
      gcSessions() // forget the previous slot session (unless another slot uses it)
    },
    [clientRef, gcSessions, validAgent, markCodeSession],
  )

  const newSession = useCallback(
    async (slot: SlotId, agent: string) => {
      const client = clientRef.current
      if (!client) return
      const id = await client.createSession(DEFAULT_TITLE[slot])
      rebindSlot(slot, id, false) // fresh session → do not carry the old transcript
      setSessionAgent(id, validAgent(agent))
      if (slot === "code") markCodeSession(id) // remember it as a code session
    },
    [clientRef, rebindSlot, setSessionAgent, validAgent, markCodeSession],
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
      unmarkCodeSession(sessionId) // drop it from the code-session kind registry too
      gcSessions() // drop the deleted id from the client-side registry
    },
    [clientRef, rebindSlot, gcSessions, unmarkCodeSession],
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
    codeSessionIds,
    cadModel,
    cadBusy,
    cadError,
    clearCadModel,
    fallbackToLocal,
    acceptOpenRouterSwitch,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
