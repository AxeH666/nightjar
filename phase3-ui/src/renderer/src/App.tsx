import { useEffect, useRef, useState, useCallback } from "react"
import { OpenCodeClient, toolCallFromPart } from "./lib/opencode"
import type { AgentInfo, PermissionAsk, ReplyKind, OpenCodeEvent, FilePart } from "./lib/opencode"
import { suggestMode } from "./lib/suggestMode"
import { ChatSurface, type UiMessage, type UiBlock } from "./components/ChatSurface"
import { type Attachment, loadGeneratedImage } from "./lib/attachments"
import { ModeSelector } from "./components/ModeSelector"
import { SuggestionBanner } from "./components/SuggestionBanner"
import { PermissionPanel } from "./components/PermissionPanel"
import { NightjarOrb } from "./components/orb/NightjarOrb"
import { HealthStrip, type ServiceStatus } from "./components/HealthStrip"
import { ModelSwitcher } from "./components/ModelSwitcher"
import { CloudBanner } from "./components/CloudBanner"
import { VisionBanner } from "./components/VisionBanner"
import { BYOKSettings } from "./components/BYOKSettings"
import {
  byok,
  modelChoices,
  isLocalModel,
  LOCAL_MODEL,
  openRouterConfigured,
  isRateLimitError,
  providerNameOf,
  OPENROUTER_FREE_CHOICE,
  type ModelChoice,
} from "./lib/byok"

declare global {
  interface Window {
    nightjar?: {
      getConfig(): Promise<{ opencodeUrl: string; sideChannelUrl?: string }>
      getStatus?(): Promise<ServiceStatus[]>
      onStatus?(cb: (s: ServiceStatus[]) => void): () => void
      readAudio?(path: string): Promise<ArrayBuffer>
      byok?: {
        keyStorageMode(): Promise<string>
        list(): Promise<unknown[]>
        set(providerId: string, key: string): Promise<void>
        remove(providerId: string): Promise<void>
      }
    }
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function App() {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [mode, setMode] = useState<string>("")
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<PermissionAsk | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [status, setStatus] = useState<string>("connecting…")
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [wsUrl, setWsUrl] = useState<string>("ws://127.0.0.1:8765")
  // BYOK: active model is GLOBAL (applies to whatever mode is active). Chosen over
  // per-mode for simplicity — the per-prompt `model` arg already supports per-mode
  // later; this keeps one piece of state. Default = local offline model.
  const [choices, setChoices] = useState<ModelChoice[]>([LOCAL_MODEL])
  const [activeModel, setActiveModel] = useState<string>(LOCAL_MODEL.id)
  const [showKeys, setShowKeys] = useState(false)
  const [fallbackOffer, setFallbackOffer] = useState<string | null>(null) // last prompt text, if a cloud send failed
  // OpenRouter rate-limit (429) switch offer: last prompt + the provider that 429'd.
  const [rateLimitOffer, setRateLimitOffer] = useState<{ text: string; provider: string } | null>(null)
  // Bump to force the connect effect to re-run. A BYOK key change restarts
  // opencode-serve, which kills our SSE stream and invalidates the session id;
  // without a reconnect, chat stays broken (dead stream, stale session) until a
  // full reload. byok.set/remove await the restart, so by the time we bump this
  // the fresh engine is already healthy and the reconnect lands on it.
  const [reconnectTick, setReconnectTick] = useState(0)
  const lastSentRef = useRef<string>("")
  // mirror activeModel into a ref so the SSE handler can read it without being a
  // dependency (which would tear down + resubscribe the stream on every switch).
  const activeModelRef = useRef<string>(LOCAL_MODEL.id)
  // Mirrors for the SSE handler (refs so it needn't depend on — and resubscribe on
  // — these): the current choice list (for the 429 banner's provider name) and
  // whether OpenRouter is configured (so a free-model fallback is even possible).
  const choicesRef = useRef<ModelChoice[]>([LOCAL_MODEL])
  const openRouterReadyRef = useRef<boolean>(false)

  const loadModels = useCallback(async () => {
    const providers = (await byok.list()) as Awaited<ReturnType<typeof byok.list>>
    openRouterReadyRef.current = openRouterConfigured(providers)
    const next = modelChoices(providers)
    setChoices(next)
    // if the active model's provider key was removed, fall back to local
    setActiveModel((cur) => (next.some((c) => c.id === cur) ? cur : LOCAL_MODEL.id))
  }, [])
  useEffect(() => {
    loadModels()
  }, [loadModels])

  const activeChoice = choices.find((c) => c.id === activeModel) ?? LOCAL_MODEL
  useEffect(() => {
    activeModelRef.current = activeModel
  }, [activeModel])
  useEffect(() => {
    choicesRef.current = choices
  }, [choices])

  const clientRef = useRef<OpenCodeClient | null>(null)
  const sessionRef = useRef<string>("")
  // partID -> {messageID, text} buffers for streaming text assembly
  const textParts = useRef<Map<string, { messageID: string; text: string }>>(new Map())
  // server messageID -> role (from message.updated). Used to drop the server's
  // echo of the USER message — send() already renders the user's message
  // optimistically, so rendering the echo too would duplicate it (NJ-3).
  const roleById = useRef<Map<string, "user" | "assistant">>(new Map())
  // parts that arrive BEFORE their message.updated (role still unknown). We must
  // not assume "assistant" — a user echo's part would then render as a second
  // assistant bubble. Stash here and flush once the role is known.
  const pendingParts = useRef<Map<string, any[]>>(new Map())
  // callIDs whose generated image we've already loaded inline (avoid re-appending).
  const loadedImages = useRef<Set<string>>(new Set())

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

  const upsertTool = useCallback((messageID: string, call: ReturnType<typeof toolCallFromPart>) => {
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
    if (call.status === "completed" && call.output && /generate_image/i.test(call.tool) && !loadedImages.current.has(call.callID)) {
      const m = /generated-image\/([A-Za-z0-9._-]+\.(?:png|jpe?g|webp))/i.exec(call.output)
      if (m) {
        loadedImages.current.add(call.callID)
        loadGeneratedImage(m[1]).then((src) => {
          if (!src) return
          setMessages((prev) =>
            prev.map((mm) => (mm.id === messageID ? { ...mm, blocks: [...mm.blocks, { kind: "image", src, name: m[1] }] } : mm)),
          )
        })
      }
    }
  }, [])

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
  const handleEvent = useCallback(
    (e: OpenCodeEvent) => {
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
        case "permission.asked":
        case "permission.v2.asked":
          if (mine) setAsk(p as PermissionAsk)
          break
        case "permission.replied":
        case "permission.v2.replied":
          setAsk((cur) => (cur && cur.id === (p.requestID ?? p.id) ? null : cur))
          break
        case "session.idle":
        case "turn.idle":
          if (mine) setBusy(false)
          break
        case "session.error":
          if (mine) {
            setBusy(false)
            const name: string | undefined = p.error?.name
            setStatus(`error: ${name ?? p.error ?? "unknown"}`)
            // Graceful cloud fallback: a cloud model failing (bad/expired key,
            // rate limit, provider down) should offer local, not silently die.
            // But NOT every session.error is the cloud provider's fault — a user
            // abort or a local tool/MCP failure isn't, and offering "the cloud
            // model failed, retry on local" for those is misleading. Skip those.
            const notProviderFailure = name === "MessageAbortedError" || name === "MCPFailed"
            const activeM = activeModelRef.current
            const lastText = lastSentRef.current
            if (!isLocalModel(activeM) && lastText && !notProviderFailure) {
              // Rate-limit (429) on a paid cloud provider + OpenRouter configured →
              // offer a switch to a free OpenRouter model (never silent). Otherwise
              // fall back to the local-retry offer.
              if (isRateLimitError(p.error) && openRouterReadyRef.current && activeM !== OPENROUTER_FREE_CHOICE.id) {
                setRateLimitOffer({ text: lastText, provider: providerNameOf(activeM, choicesRef.current) })
              } else {
                setFallbackOffer(lastText)
              }
            }
          }
          break
      }
    },
    [ensureMessage, setTextBlock, upsertTool, applyAssistantPart],
  )

  // ---- sidecar status strip (from the Electron supervisor) ----
  useEffect(() => {
    let off: (() => void) | undefined
    window.nightjar?.getStatus?.().then(setServices).catch(() => {})
    off = window.nightjar?.onStatus?.(setServices)
    return () => off?.()
  }, [])

  // ---- connect (retry until OpenCode is reachable — the supervisor may still
  // be bringing it up, esp. during a cold model load) ----
  useEffect(() => {
    const ac = new AbortController()
    ;(async () => {
      const cfg = (await window.nightjar?.getConfig?.()) ?? {
        opencodeUrl: (import.meta as any).env?.VITE_OPENCODE_URL || "http://127.0.0.1:4096",
        sideChannelUrl: (import.meta as any).env?.VITE_NIGHTJAR_WS_URL || "ws://127.0.0.1:8765",
      }
      if (cfg.sideChannelUrl) setWsUrl(cfg.sideChannelUrl)
      const client = new OpenCodeClient(cfg.opencodeUrl)
      clientRef.current = client
      for (let attempt = 0; !ac.signal.aborted; attempt++) {
        try {
          const list = await client.listAgents()
          setAgents(list)
          setMode(list.find((a) => a.name === "assistant")?.name ?? list[0]?.name ?? "")
          sessionRef.current = await client.createSession("Nightjar session")
          setStatus(`connected · ${cfg.opencodeUrl}`)
          client.subscribe(handleEvent, ac.signal).catch((err) => setStatus(`stream closed: ${err}`))
          return
        } catch (err: any) {
          setStatus(`waiting for engine… (${err?.message ?? err})`)
          await sleep(2000)
        }
      }
    })()
    return () => ac.abort()
  }, [handleEvent, reconnectTick])

  // ---- actions ----
  function send(text: string, attachments?: Attachment[], modelOverride?: string) {
    const client = clientRef.current
    if (!client || !sessionRef.current || !mode) return
    const atts = attachments ?? []
    setSuggestion(null)
    setFallbackOffer(null)
    setRateLimitOffer(null)
    const sug = suggestMode(text, mode, agents.map((a) => a.name))
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
  }

  // Create Image button: steer the agent to call the image-generation tool directly.
  // OpenCode has no client-side tool_choice, so this is a strong directive; the tool
  // is granted in ASSISTANT mode, so we run there.
  function createImage(prompt: string) {
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
  }

  // Retry the last prompt on the local model after a cloud failure.
  function fallbackToLocal() {
    const text = fallbackOffer
    setFallbackOffer(null)
    setActiveModel(LOCAL_MODEL.id)
    if (text) send(text, undefined, LOCAL_MODEL.id)
  }

  // Accept the rate-limit switch: move to the free OpenRouter model and resend the
  // last prompt. The choice **persists for the session** — OpenRouter stays the
  // active model, so the paid provider isn't hit again unless the user switches back.
  function acceptOpenRouterSwitch() {
    const text = rateLimitOffer?.text
    setRateLimitOffer(null)
    setActiveModel(OPENROUTER_FREE_CHOICE.id)
    if (text) send(text, undefined, OPENROUTER_FREE_CHOICE.id)
  }

  async function reply(kind: ReplyKind) {
    const client = clientRef.current
    if (!client || !ask) return
    const id = ask.id
    setAsk(null)
    await client.replyPermission(id, kind).catch((err) => setStatus(`reply failed: ${err}`))
  }

  async function abort() {
    const client = clientRef.current
    setAsk(null)
    setBusy(false)
    if (client && sessionRef.current) await client.abort(sessionRef.current).catch(() => {})
  }

  return (
    <div className="flex h-full flex-col bg-nightjar-base">
      <header className="flex items-center gap-3 border-b border-nightjar-surface px-4 py-2">
        <span className="font-semibold text-nightjar-accent">Nightjar</span>
        {agents.length > 0 && <ModeSelector agents={agents} active={mode} onChange={setMode} />}
        <div className="ml-auto flex items-center gap-3">
          <ModelSwitcher
            choices={choices}
            activeId={activeModel}
            onSelect={setActiveModel}
            onManageKeys={() => setShowKeys(true)}
          />
          <span className="text-xs text-nightjar-text/40">{status}</span>
          <NightjarOrb wsUrl={wsUrl} />
        </div>
      </header>

      {/* Unmissable cloud-active indicator (privacy). Renders nothing when local. */}
      <CloudBanner model={activeChoice} onSwitchLocal={() => setActiveModel(LOCAL_MODEL.id)} />

      <HealthStrip services={services} />
      <VisionBanner />

      {rateLimitOffer && (
        <div className="flex items-center gap-3 border-b border-nightjar-alert/50 bg-nightjar-alert/10 px-4 py-2 text-sm text-nightjar-text/90">
          <span>
            You've hit your usage limit on {rateLimitOffer.provider}. Switch to a free OpenRouter model to continue?
          </span>
          <button
            onClick={acceptOpenRouterSwitch}
            className="rounded-md bg-nightjar-accent px-3 py-1 text-xs font-medium text-nightjar-base hover:brightness-110"
          >
            Switch to free OpenRouter
          </button>
          <button
            onClick={() => {
              const t = rateLimitOffer.text
              setRateLimitOffer(null)
              setFallbackOffer(t) // still offer the local offline escape hatch
            }}
            className="text-xs text-nightjar-text/50 hover:underline"
          >
            dismiss
          </button>
        </div>
      )}

      {fallbackOffer && (
        <div className="flex items-center gap-3 border-b border-nightjar-alert/50 bg-nightjar-alert/10 px-4 py-2 text-sm text-nightjar-text/90">
          <span>The cloud model failed (bad/expired key, rate limit, or provider down).</span>
          <button
            onClick={fallbackToLocal}
            className="rounded-md bg-nightjar-accent px-3 py-1 text-xs font-medium text-nightjar-base hover:brightness-110"
          >
            Retry on local model
          </button>
          <button onClick={() => setFallbackOffer(null)} className="text-xs text-nightjar-text/50 hover:underline">
            dismiss
          </button>
        </div>
      )}

      {suggestion && (
        <SuggestionBanner
          suggested={suggestion}
          onAccept={() => {
            setMode(suggestion)
            setSuggestion(null)
          }}
          onDismiss={() => setSuggestion(null)}
        />
      )}

      <main className="min-h-0 flex-1">
        <ChatSurface messages={messages} busy={busy} onSend={send} onCreateImage={createImage} />
      </main>

      {ask && <PermissionPanel ask={ask} onReply={reply} onAbort={abort} />}
      {showKeys && (
        <BYOKSettings
          onClose={() => setShowKeys(false)}
          onChanged={() => {
            // key added/removed → engine was restarted; refresh model choices and
            // re-establish the session + SSE stream against the fresh engine (the
            // old session id and stream are dead after the restart).
            setStatus("applying key — reconnecting…")
            loadModels()
            setReconnectTick((t) => t + 1)
          }}
        />
      )}
    </div>
  )
}
