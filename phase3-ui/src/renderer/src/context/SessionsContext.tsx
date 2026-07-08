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
import { suggestMode } from "../lib/suggestMode"
import { type UiMessage, type UiBlock } from "../components/ChatSurface"
import { type Attachment, loadGeneratedImage } from "../lib/attachments"
import { isLocalModel, LOCAL_MODEL, OPENROUTER_FREE_CHOICE } from "../lib/byok"
import { useConnection, useOpenCodeEvents } from "./ConnectionContext"
import { useModel } from "./ModelContext"
import { useArtifact } from "./ArtifactContext"

export type SlotId = "chat" | "code"

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
}
const freshRefs = (): RefBundle => ({
  textParts: new Map(),
  roleById: new Map(),
  pendingParts: new Map(),
  loadedImages: new Set(),
  lastSent: "",
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const DEFAULT_AGENT: Record<SlotId, string> = { chat: "assistant", code: "coding" }
const DEFAULT_TITLE: Record<SlotId, string> = { chat: "Nightjar chat", code: "Nightjar coding" }

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
  createImage: (sessionId: string, prompt: string) => void
  setSessionAgent: (sessionId: string, agent: string) => void
  // session-history list (Code tab)
  listSessions: () => Promise<SessionInfo[]>
  resumeSession: (slot: SlotId, sessionId: string, agent: string) => Promise<void>
  newSession: (slot: SlotId, agent: string) => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  renameSession: (sessionId: string, title: string) => Promise<void>
  // safety-critical accessors (PermissionContext)
  hasSession: (sid: string) => boolean
  setBusy: (sid: string, val: boolean) => void
  // recovery offers (chat slot) + soft mode nudge
  suggestion: string | null
  setSuggestion: (s: string | null) => void
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
  const [slots, setSlots] = useState<Record<SlotId, string>>({ chat: "", code: "" })
  const [suggestion, setSuggestion] = useState<string | null>(null)

  const perSessionRefs = useRef<Map<string, RefBundle>>(new Map())
  const sessionsRef = useRef<Record<string, SessionState>>({})
  const slotsRef = useRef<Record<SlotId, string>>({ chat: "", code: "" })
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])
  useEffect(() => {
    slotsRef.current = slots
  }, [slots])

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

  // Bind a slot to a (new) session id, carrying over the old slot session's
  // transcript + agent so a reconnect doesn't wipe the visible conversation.
  const rebindSlot = useCallback((slot: SlotId, newId: string, carry: boolean) => {
    const oldId = slotsRef.current[slot]
    const old = carry && oldId ? sessionsRef.current[oldId] : undefined
    perSessionRefs.current.set(newId, freshRefs())
    if (oldId && oldId !== newId) perSessionRefs.current.delete(oldId)
    setSessions((prev) => {
      const next = { ...prev }
      if (oldId && oldId !== newId) delete next[oldId]
      next[newId] = {
        id: newId,
        agent: old?.agent ?? DEFAULT_AGENT[slot],
        title: old?.title ?? DEFAULT_TITLE[slot],
        messages: old?.messages ?? [],
        busy: false,
      }
      return next
    })
    slotsRef.current = { ...slotsRef.current, [slot]: newId }
    setSlots((prev) => ({ ...prev, [slot]: newId }))
  }, [])

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
      case "turn.idle":
        setBusy(sid, false)
        break
      case "session.error": {
        setBusy(sid, false)
        const name: string | undefined = p.error?.name
        setStatus(`error: ${name ?? p.error ?? "unknown"}`)
        handleSessionError(p.error, refs.lastSent)
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
          const codeId = await client.createSession(DEFAULT_TITLE.code)
          if (!cancelled) rebindSlot("code", codeId, true)
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
      setSuggestion(null)
      setFallbackOffer(null)
      setRateLimitOffer(null)
      const sug = suggestMode(
        text,
        agent,
        agents.map((a) => a.name),
      )
      if (sug) setSuggestion(sug)
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
      const files: FilePart[] = atts.map((a) => ({ mime: a.mime, url: a.dataUrl, filename: a.name }))
      const imgPaths = atts.filter((a) => a.isImage && a.path).map((a) => a.path as string)
      const promptText = imgPaths.length
        ? `${text ? text + "\n\n" : ""}[The user attached ${imgPaths.length} image${imgPaths.length > 1 ? "s" : ""} at: ${imgPaths.join(", ")}. If you can see the image(s) directly, use them; otherwise call the analyze_image tool with the path to describe each.]`
        : text
      client.promptAsync(sessionId, promptText, agent, model, files).catch((err) => {
        setBusy(sessionId, false)
        setStatus(`send failed: ${err?.message ?? err}`)
        if (!isLocalModel(model)) setFallbackOffer(text)
      })
    },
    [agents, activeModel, clientRef, setStatus, setFallbackOffer, setRateLimitOffer, updateMessages, setBusy],
  )

  const createImage = useCallback(
    (sessionId: string, prompt: string) => {
      const client = clientRef.current
      const refs = perSessionRefs.current.get(sessionId)
      if (!client || !refs) return
      const imgAgent = agents.some((a) => a.name === "assistant") ? "assistant" : sessionsRef.current[sessionId]?.agent
      if (!imgAgent) return
      setSessionAgent(sessionId, imgAgent)
      setSuggestion(null)
      setFallbackOffer(null)
      setRateLimitOffer(null)
      const uid = `local-${Date.now()}`
      updateMessages(sessionId, (prev) => [...prev, { id: uid, role: "user", blocks: [{ kind: "text", text: `🎨 Create image: ${prompt}` }] }])
      setBusy(sessionId, true)
      refs.lastSent = prompt
      const directive = `Use the generate_image tool to create an image now. Image description: "${prompt}". Call the tool immediately; do not ask follow-up questions.`
      client.promptAsync(sessionId, directive, imgAgent, activeModel).catch((err) => {
        setBusy(sessionId, false)
        setStatus(`create image failed: ${err?.message ?? err}`)
      })
    },
    [agents, activeModel, clientRef, setSessionAgent, setStatus, setFallbackOffer, setRateLimitOffer, updateMessages, setBusy],
  )

  // Retry the last chat prompt on the local model after a cloud failure.
  const fallbackToLocal = useCallback(() => {
    const text = fallbackOffer
    setFallbackOffer(null)
    setActiveModel(LOCAL_MODEL.id)
    if (text) send(slotsRef.current.chat, text, { model: LOCAL_MODEL.id })
  }, [fallbackOffer, setFallbackOffer, setActiveModel, send])

  // Accept the 429 switch: move to the free OpenRouter model (persists for the
  // session) and resend the last chat prompt.
  const acceptOpenRouterSwitch = useCallback(() => {
    const text = rateLimitOffer?.text
    setRateLimitOffer(null)
    setActiveModel(OPENROUTER_FREE_CHOICE.id)
    if (text) send(slotsRef.current.chat, text, { model: OPENROUTER_FREE_CHOICE.id })
  }, [rateLimitOffer, setRateLimitOffer, setActiveModel, send])

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
    async (slot: SlotId, sessionId: string, agent: string) => {
      const client = clientRef.current
      if (!client) return
      let messages: UiMessage[] = []
      try {
        messages = messagesFromHistory(await client.getMessages(sessionId))
      } catch {
        /* engine has no history → empty (still switch to the live session) */
      }
      perSessionRefs.current.set(sessionId, freshRefs())
      setSessions((prev) => ({
        ...prev,
        [sessionId]: { id: sessionId, agent, title: prev[sessionId]?.title ?? DEFAULT_TITLE[slot], messages, busy: false },
      }))
      slotsRef.current = { ...slotsRef.current, [slot]: sessionId }
      setSlots((prev) => ({ ...prev, [slot]: sessionId }))
    },
    [clientRef],
  )

  const newSession = useCallback(
    async (slot: SlotId, agent: string) => {
      const client = clientRef.current
      if (!client) return
      const id = await client.createSession(DEFAULT_TITLE[slot])
      rebindSlot(slot, id, false) // fresh session → do not carry the old transcript
      setSessionAgent(id, agent)
    },
    [clientRef, rebindSlot, setSessionAgent],
  )

  const deleteSession = useCallback(
    async (sessionId: string) => {
      const client = clientRef.current
      if (!client) return
      await client.deleteSession(sessionId).catch(() => {})
    },
    [clientRef],
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
    suggestion,
    setSuggestion,
    fallbackToLocal,
    acceptOpenRouterSwitch,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
