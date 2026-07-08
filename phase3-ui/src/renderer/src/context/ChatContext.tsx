// ChatContext — the conversation: messages, busy, the current mode (agent), the
// streaming event-assembly reducer (the NJ-3 dedup logic, preserved VERBATIM),
// and the send/createImage/fallback actions.
//
// Registers the message.*/session.idle/session.error slice of the old
// handleEvent via useOpenCodeEvents, filtering by sessionID. session.error is
// owned here (it clears busy + has lastSent) and delegates the recovery-offer
// decision to ModelContext.handleSessionError — one owner, no double-subscribe.
//
// Extracted from the former App.tsx monolith (redesign Stage 2), verbatim.
// NOTE (Stage 2): still a single session with a single `mode`. Stage 4 turns
// this into a per-tab session registry.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { toolCallFromPart } from "../lib/opencode"
import type { OpenCodeEvent, FilePart } from "../lib/opencode"
import { suggestMode } from "../lib/suggestMode"
import { type UiMessage, type UiBlock } from "../components/ChatSurface"
import { type Attachment, loadGeneratedImage } from "../lib/attachments"
import { isLocalModel, LOCAL_MODEL, OPENROUTER_FREE_CHOICE } from "../lib/byok"
import { useConnection, useOpenCodeEvents } from "./ConnectionContext"
import { useModel } from "./ModelContext"
import { useArtifact } from "./ArtifactContext"

interface ChatValue {
  messages: UiMessage[]
  busy: boolean
  setBusy: (v: boolean) => void
  mode: string
  setMode: (m: string) => void
  suggestion: string | null
  setSuggestion: (s: string | null) => void
  send: (text: string, attachments?: Attachment[], modelOverride?: string) => void
  createImage: (prompt: string) => void
  fallbackToLocal: () => void
  acceptOpenRouterSwitch: () => void
}

const Ctx = createContext<ChatValue | null>(null)

export function useChat(): ChatValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useChat must be used within a ChatProvider")
  return v
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { clientRef, sessionRef, agents, setStatus } = useConnection()
  const {
    activeModel,
    setActiveModel,
    fallbackOffer,
    setFallbackOffer,
    rateLimitOffer,
    setRateLimitOffer,
    handleSessionError,
  } = useModel()
  const { onToolCall } = useArtifact()

  const [messages, setMessages] = useState<UiMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<string>("")
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const lastSentRef = useRef<string>("")

  // partID -> {messageID, text} buffers for streaming text assembly
  const textParts = useRef<Map<string, { messageID: string; text: string }>>(new Map())
  // server messageID -> role (from message.updated). Used to drop the server's
  // echo of the USER message — send() already renders it optimistically, so
  // rendering the echo too would duplicate it (NJ-3).
  const roleById = useRef<Map<string, "user" | "assistant">>(new Map())
  // parts that arrive BEFORE their message.updated (role still unknown). We must
  // not assume "assistant" — a user echo's part would then render as a second
  // assistant bubble. Stash here and flush once the role is known.
  const pendingParts = useRef<Map<string, any[]>>(new Map())
  // callIDs whose generated image we've already loaded inline (avoid re-appending).
  const loadedImages = useRef<Set<string>>(new Set())

  // Initialise mode when agents first arrive, and RE-VALIDATE whenever the agent
  // list changes (a reconnect re-fetches it): keep a still-valid user choice, but
  // if the persisted mode is no longer a real agent, fall back to the default —
  // otherwise send() would POST prompts to a non-existent agent. (The connect loop
  // used to hard-reset to "assistant" on every reconnect; this preserves the
  // choice when it is still valid instead.)
  useEffect(() => {
    if (agents.length === 0) return
    const fallback = agents.find((a) => a.name === "assistant")?.name ?? agents[0]?.name ?? ""
    setMode((cur) => (cur && agents.some((a) => a.name === cur) ? cur : fallback))
  }, [agents])

  // ---- upsert helpers over UiMessage[] ----
  const ensureMessage = useCallback((id: string, role: "user" | "assistant") => {
    setMessages((prev) => (prev.some((m) => m.id === id) ? prev : [...prev, { id, role, blocks: [] }]))
  }, [])

  const setTextBlock = useCallback((messageID: string, partID: string, text: string) => {
    setMessages((prev) =>
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
  }, [])

  const upsertTool = useCallback(
    (messageID: string, call: ReturnType<typeof toolCallFromPart>) => {
      if (!call) return
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageID) return m
          const blocks = [...m.blocks]
          const idx = blocks.findIndex((b) => b.kind === "tool" && b.call.callID === call.callID)
          if (idx >= 0) blocks[idx] = { kind: "tool", call }
          else blocks.push({ kind: "tool", call })
          return { ...m, blocks }
        }),
      )
      // When an image-generation tool completes, load the PNG from disk and append it
      // as an inline image (the tool returns a web link that isn't served in the app).
      if (
        call.status === "completed" &&
        call.output &&
        /generate_image/i.test(call.tool) &&
        !loadedImages.current.has(call.callID)
      ) {
        const m = /generated-image\/([A-Za-z0-9._-]+\.(?:png|jpe?g|webp))/i.exec(call.output)
        if (m) {
          loadedImages.current.add(call.callID)
          loadGeneratedImage(m[1]).then((src) => {
            if (!src) return
            setMessages((prev) =>
              prev.map((mm) =>
                mm.id === messageID ? { ...mm, blocks: [...mm.blocks, { kind: "image", src, name: m[1] }] } : mm,
              ),
            )
          })
        }
      }
      // Delegate live-preview mirroring to ArtifactContext.
      onToolCall(call, sessionRef.current)
    },
    [onToolCall, sessionRef],
  )

  // Render one assistant message part (text or tool). Used both for live parts
  // and for parts replayed from the pending buffer once the role is known.
  const applyAssistantPart = useCallback(
    (part: any) => {
      ensureMessage(part.messageID, "assistant")
      if (part.type === "text") {
        textParts.current.set(part.id, { messageID: part.messageID, text: part.text ?? "" })
        setTextBlock(part.messageID, part.id, part.text ?? "")
      } else if (part.type === "tool") {
        upsertTool(part.messageID, toolCallFromPart(part))
      }
    },
    [ensureMessage, setTextBlock, upsertTool],
  )

  // ---- event handling (filtered by our sessionID — the stream is instance-wide) ----
  useOpenCodeEvents((e: OpenCodeEvent) => {
    const p = e.properties ?? {}
    const sid = p.sessionID ?? p.info?.sessionID ?? p.part?.sessionID
    const mine = sessionRef.current && sid === sessionRef.current

    switch (e.type) {
      case "message.updated":
        if (mine && p.info) {
          const role: "user" | "assistant" = p.info.role
          roleById.current.set(p.info.id, role)
          const stashed = pendingParts.current.get(p.info.id)
          pendingParts.current.delete(p.info.id)
          if (role === "assistant") {
            // Only render assistant messages from the server; the user's own
            // message is already shown optimistically by send() (NJ-3).
            ensureMessage(p.info.id, "assistant")
            // Flush any parts that arrived before this role was known.
            stashed?.forEach((part) => applyAssistantPart(part))
          }
          // role === "user": discard stashed parts (rendered optimistically).
        }
        break
      case "message.part.updated": {
        if (!mine) break
        const part = p.part
        if (!part) break
        const role = roleById.current.get(part.messageID)
        // Known user echo → drop (rendered optimistically already, NJ-3).
        if (role === "user") break
        // Role not known yet → stash; do NOT assume assistant, or a user echo
        // whose part precedes its message.updated would render as a second
        // assistant bubble.
        if (role === undefined) {
          const arr = pendingParts.current.get(part.messageID) ?? []
          // de-dupe by part id so a re-updated part replaces its earlier copy
          const i = arr.findIndex((q) => q.id === part.id)
          if (i >= 0) arr[i] = part
          else arr.push(part)
          pendingParts.current.set(part.messageID, arr)
          break
        }
        applyAssistantPart(part)
        break
      }
      case "message.part.delta": {
        if (!mine) break
        const buf = textParts.current.get(p.partID)
        if (buf && p.field === "text") {
          buf.text += p.delta ?? ""
          setTextBlock(buf.messageID, p.partID, buf.text)
        }
        break
      }
      case "session.idle":
      case "turn.idle":
        if (mine) setBusy(false)
        break
      case "session.error":
        if (mine) {
          setBusy(false)
          const name: string | undefined = p.error?.name
          setStatus(`error: ${name ?? p.error ?? "unknown"}`)
          handleSessionError(p.error, lastSentRef.current)
        }
        break
    }
  })

  // ---- actions ----
  const send = useCallback(
    (text: string, attachments?: Attachment[], modelOverride?: string) => {
      const client = clientRef.current
      if (!client || !sessionRef.current || !mode) return
      const atts = attachments ?? []
      setSuggestion(null)
      setFallbackOffer(null)
      setRateLimitOffer(null)
      const sug = suggestMode(
        text,
        mode,
        agents.map((a) => a.name),
      )
      if (sug) setSuggestion(sug)
      const uid = `local-${Date.now()}`
      // Optimistic render: the text + attachment previews (image thumbnails / file chips).
      const blocks: UiBlock[] = []
      if (text) blocks.push({ kind: "text", text })
      for (const a of atts) {
        if (a.isImage) blocks.push({ kind: "image", src: a.dataUrl, name: a.name })
        else blocks.push({ kind: "file", name: a.name, mime: a.mime, size: a.size })
      }
      if (blocks.length === 0) blocks.push({ kind: "text", text: "" })
      setMessages((prev) => [...prev, { id: uid, role: "user", blocks }])
      setBusy(true)
      lastSentRef.current = text
      const model = modelOverride ?? activeModel
      // Attachments as OpenCode `file` parts (base64 data URLs). A vision-capable cloud
      // model sees images directly; a text-only model gets an auto-inserted "can't read"
      // note — so for images with a saved path we ALSO steer the local model to the
      // path-taking vision tool. The original text stays in the bubble; the hint only
      // rides to the agent (not shown).
      const files: FilePart[] = atts.map((a) => ({ mime: a.mime, url: a.dataUrl, filename: a.name }))
      const imgPaths = atts.filter((a) => a.isImage && a.path).map((a) => a.path as string)
      const promptText = imgPaths.length
        ? `${text ? text + "\n\n" : ""}[The user attached ${imgPaths.length} image${imgPaths.length > 1 ? "s" : ""} at: ${imgPaths.join(", ")}. If you can see the image(s) directly, use them; otherwise call the analyze_image tool with the path to describe each.]`
        : text
      client.promptAsync(sessionRef.current, promptText, mode, model, files).catch((err) => {
        setBusy(false)
        setStatus(`send failed: ${err?.message ?? err}`)
        if (!isLocalModel(model)) setFallbackOffer(text)
      })
    },
    [mode, agents, activeModel, clientRef, sessionRef, setStatus, setFallbackOffer, setRateLimitOffer],
  )

  // Create Image button: steer the agent to call the image-generation tool directly.
  // OpenCode has no client-side tool_choice, so this is a strong directive; the tool
  // is granted in ASSISTANT mode, so we run there.
  const createImage = useCallback(
    (prompt: string) => {
      const client = clientRef.current
      if (!client || !sessionRef.current) return
      const imgAgent = agents.some((a) => a.name === "assistant") ? "assistant" : mode
      if (!imgAgent) return
      if (imgAgent !== mode) setMode(imgAgent)
      setSuggestion(null)
      setFallbackOffer(null)
      setRateLimitOffer(null)
      const uid = `local-${Date.now()}`
      setMessages((prev) => [...prev, { id: uid, role: "user", blocks: [{ kind: "text", text: `🎨 Create image: ${prompt}` }] }])
      setBusy(true)
      lastSentRef.current = prompt
      const directive = `Use the generate_image tool to create an image now. Image description: "${prompt}". Call the tool immediately; do not ask follow-up questions.`
      client.promptAsync(sessionRef.current, directive, imgAgent, activeModel).catch((err) => {
        setBusy(false)
        setStatus(`create image failed: ${err?.message ?? err}`)
      })
    },
    [agents, mode, activeModel, clientRef, sessionRef, setStatus, setFallbackOffer, setRateLimitOffer],
  )

  // Retry the last prompt on the local model after a cloud failure.
  const fallbackToLocal = useCallback(() => {
    const text = fallbackOffer
    setFallbackOffer(null)
    setActiveModel(LOCAL_MODEL.id)
    if (text) send(text, undefined, LOCAL_MODEL.id)
  }, [fallbackOffer, setFallbackOffer, setActiveModel, send])

  // Accept the rate-limit switch: move to the free OpenRouter model and resend the
  // last prompt. The choice **persists for the session** — OpenRouter stays the
  // active model, so the paid provider isn't hit again unless the user switches back.
  const acceptOpenRouterSwitch = useCallback(() => {
    const text = rateLimitOffer?.text
    setRateLimitOffer(null)
    setActiveModel(OPENROUTER_FREE_CHOICE.id)
    if (text) send(text, undefined, OPENROUTER_FREE_CHOICE.id)
  }, [rateLimitOffer, setRateLimitOffer, setActiveModel, send])

  const value: ChatValue = {
    messages,
    busy,
    setBusy,
    mode,
    setMode,
    suggestion,
    setSuggestion,
    send,
    createImage,
    fallbackToLocal,
    acceptOpenRouterSwitch,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
