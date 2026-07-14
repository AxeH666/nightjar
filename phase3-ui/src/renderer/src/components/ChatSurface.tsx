import { useState, useEffect, useRef, type ClipboardEvent, type DragEvent } from "react"
import type { ToolCall } from "../lib/opencode"
import { ToolCallCard } from "./ToolCallCard"
import { ToolsMenu } from "./composer/ToolsMenu"
import { type Attachment, type AttachmentResult, pickAttachments, attachmentsFromDataTransfer, fmtSize } from "../lib/attachments"
import { useModel } from "../context/ModelContext"
import { isLocalModel } from "../lib/byok"

// Local-vision readiness (Ollama + gemma3:4b), mirrored from the main process — used
// to warn before an image is sent to the text-only local model (NJ-7).
type VisionStatus = { ollama?: string; model?: string }
function visionBridge() {
  return (
    window as unknown as {
      nightjar?: {
        getVisionStatus?(): Promise<VisionStatus>
        onVisionStatus?(cb: (s: VisionStatus) => void): () => void
        installVisionModel?(): Promise<unknown>
        openOllamaDownload?(): Promise<void>
      }
    }
  ).nightjar
}
// Returns null until the first status resolves (so the composer never false-warns
// before we know), then true/false. Gated on OLLAMA being up — NOT on a specific
// model's present/missing: that status is keyed on NIGHTJAR_VISION_MODEL (vision.ts)
// and can disagree with the analyzer's own model (vision_settings.json). The
// model-missing case is caught authoritatively by analyze_image's probe + the banner.
function useVisionReadiness(): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null)
  useEffect(() => {
    const b = visionBridge()
    if (!b?.getVisionStatus) return
    const upd = (s: VisionStatus) => setReady(s?.ollama === "running")
    b.getVisionStatus().then(upd).catch(() => {})
    return b.onVisionStatus?.(upd)
  }, [])
  return ready
}

export type UiBlock =
  | { kind: "text"; text: string }
  | { kind: "tool"; call: ToolCall }
  | { kind: "image"; src: string; name?: string }
  | { kind: "file"; name: string; mime: string; size?: number }
export interface UiMessage {
  id: string
  role: "user" | "assistant"
  blocks: UiBlock[]
}

// Per-message send options. `research` is true if the user armed Research and/or
// Web search in the "+" menu for this message; the parent screen maps it to the
// `research` agent (both toggles collapse to it — the only web-capable agent).
export interface SendOpts {
  attachments?: Attachment[]
  research?: boolean
}

// Which "+"-menu tool items this surface offers. The Code tab hides
// Research/Web-search (it always sends to the coding agent).
const DEFAULT_MENU = { research: true, webSearch: true, createImage: true }

export function ChatSurface({
  messages,
  busy,
  onSend,
  onCreateImage,
  onStop,
  menu = DEFAULT_MENU,
  emptyHint = "Ask June something.",
  placeholder = "Message June…  (Enter to send · paste or drop files)",
  assistantLabel = "june",
}: {
  messages: UiMessage[]
  busy: boolean
  onSend: (text: string, opts: SendOpts) => void
  onCreateImage: (prompt: string) => void
  onStop?: () => void
  menu?: { research: boolean; webSearch: boolean; createImage: boolean }
  emptyHint?: string
  placeholder?: string
  assistantLabel?: string
}) {
  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null) // surfaced attach failures (was silently swallowed)
  const [dragOver, setDragOver] = useState(false)
  const [createMode, setCreateMode] = useState(false) // "Create Image" prompt mode
  // Per-message tool toggles from the "+" menu (reset after each send).
  const [tools, setTools] = useState({ research: false, webSearch: false })
  // NJ-7: warn before sending an image to the text-only local model when local
  // vision (Ollama + gemma3:4b) isn't ready — with a "Send anyway" escape.
  const { activeModel } = useModel()
  const visionReady = useVisionReadiness()
  const [visionWarn, setVisionWarn] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, busy])

  // Append what succeeded; surface any per-file errors instead of silently dropping them
  // (a swallowed read error was why "Browse → pick → no chip" looked broken).
  const addResult = (res: AttachmentResult) => {
    if (res.attachments.length) setAttachments((prev) => [...prev, ...res.attachments])
    setAttachError(res.errors.length ? res.errors.join(" · ") : null)
  }
  const removeAttachment = (id: string) => setAttachments((prev) => prev.filter((a) => a.id !== id))

  async function browse() {
    if (busy) return
    addResult(await pickAttachments())
  }
  function onPaste(e: ClipboardEvent) {
    const dt = e.clipboardData
    const hasFile = !!dt && (dt.files.length > 0 || Array.from(dt.items || []).some((it) => it.kind === "file"))
    if (!hasFile) return // let normal text paste proceed
    e.preventDefault()
    attachmentsFromDataTransfer(dt).then(addResult)
  }
  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragOver(false)
    if (busy) return
    attachmentsFromDataTransfer(e.dataTransfer).then(addResult)
  }

  function submit() {
    if (busy) return
    const t = input.trim()
    if (createMode) {
      if (!t) return
      onCreateImage(t)
      setInput("")
      setCreateMode(false)
      return
    }
    if (!t && attachments.length === 0) return
    // NJ-7: sending an image to the local (text-only) model with local vision not
    // ready would silently fail the analyze tool. Warn once (setup + "Send anyway")
    // rather than hard-block or silently error. Clicking "Send anyway" re-enters
    // submit() with visionWarn already true, so it proceeds.
    if (attachments.some((a) => a.isImage) && isLocalModel(activeModel) && visionReady === false && !visionWarn) {
      setVisionWarn(true)
      return
    }
    onSend(t, { attachments, research: tools.research || tools.webSearch })
    setInput("")
    setAttachments([])
    setAttachError(null)
    setTools({ research: false, webSearch: false })
    setVisionWarn(false)
  }

  const canSend = !busy && (createMode ? !!input.trim() : !!input.trim() || attachments.length > 0)

  return (
    <div
      className="relative flex h-full flex-col"
      // The WHOLE surface is a drop zone (not just the composer bar) — dropping onto the
      // message area is the natural gesture. The window-level guard (main.tsx) already
      // stops file:// navigation; this handler processes the files.
      onDragOver={(e) => {
        e.preventDefault()
        if (!dragOver) setDragOver(true)
      }}
      onDragLeave={(e) => {
        // Only clear when the pointer actually leaves the surface (not on child→child moves).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-nightjar-accent bg-nightjar-accent/10">
          <span className="rounded-lg bg-nightjar-base/90 px-4 py-2 text-sm font-medium text-nightjar-accent">Drop files to attach</span>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 && <div className="mt-20 text-center text-nightjar-text/40">{emptyHint}</div>}
        {messages.map((m) => (
          <div key={m.id} className="mb-4">
            <div className="mb-1 text-xs uppercase tracking-wide text-nightjar-text/40">
              {m.role === "user" ? "you" : assistantLabel}
            </div>
            <div className={m.role === "user" ? "rounded-lg bg-nightjar-surface px-4 py-2 text-nightjar-text" : "text-nightjar-text/90"}>
              {m.blocks.map((b, i) => {
                if (b.kind === "text") return <p key={i} className="whitespace-pre-wrap leading-relaxed">{b.text}</p>
                if (b.kind === "tool") return <ToolCallCard key={b.call.callID} call={b.call} />
                if (b.kind === "image")
                  return (
                    <img
                      key={i}
                      src={b.src}
                      alt={b.name ?? "image"}
                      className="my-1 max-h-80 max-w-full rounded-lg border border-nightjar-surface"
                    />
                  )
                return (
                  <div
                    key={i}
                    className="my-1 inline-flex items-center gap-2 rounded-lg bg-nightjar-surface/60 px-2 py-1 text-xs text-nightjar-text/70"
                  >
                    📄 <span className="max-w-[16rem] truncate">{b.name}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        {busy && <div className="text-sm text-nightjar-accent/70">▍working…</div>}
        <div ref={endRef} />
      </div>

      <div className="border-t border-nightjar-surface p-3">
        {attachError && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-nightjar-alert/60 bg-nightjar-alert/10 px-2 py-1 text-xs text-nightjar-alert">
            <span className="flex-1">{attachError}</span>
            <button onClick={() => setAttachError(null)} className="hover:underline">dismiss</button>
          </div>
        )}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-lg bg-nightjar-surface/60 px-2 py-1 text-xs text-nightjar-text/70">
                {a.isImage ? (
                  <img src={a.dataUrl} alt={a.name} className="h-8 w-8 rounded object-cover" />
                ) : (
                  <span aria-hidden>📄</span>
                )}
                <span className="max-w-[12rem] truncate" title={a.name}>{a.name}</span>
                <span className="text-nightjar-text/40">{fmtSize(a.size)}</span>
                <button onClick={() => removeAttachment(a.id)} className="text-nightjar-text/50 hover:text-nightjar-alert" title="Remove">✕</button>
              </div>
            ))}
          </div>
        )}
        {/* Armed per-message tool chips (explicit, visible before send). */}
        {(tools.research || tools.webSearch) && !createMode && (
          <div className="mb-2 flex flex-wrap gap-2">
            {tools.research && (
              <span className="inline-flex items-center gap-1 rounded-full border border-nightjar-accent/50 bg-nightjar-accent/10 px-2 py-0.5 text-xs text-nightjar-accent">
                🔎 Research
                <button onClick={() => setTools((t) => ({ ...t, research: false }))} title="Remove" className="hover:brightness-125">✕</button>
              </span>
            )}
            {tools.webSearch && (
              <span className="inline-flex items-center gap-1 rounded-full border border-nightjar-accent/50 bg-nightjar-accent/10 px-2 py-0.5 text-xs text-nightjar-accent">
                🌐 Web search
                <button onClick={() => setTools((t) => ({ ...t, webSearch: false }))} title="Remove" className="hover:brightness-125">✕</button>
              </span>
            )}
          </div>
        )}
        {createMode && (
          <div className="mb-2 flex items-center gap-2 text-xs text-nightjar-accent">
            🎨 Create-Image mode — describe the image, then press Create.
            <button onClick={() => setCreateMode(false)} className="text-nightjar-text/50 hover:underline">cancel</button>
          </div>
        )}
        {visionWarn && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-nightjar-alert/40 bg-nightjar-alert/10 px-3 py-2 text-xs text-nightjar-text/80">
            <span>👁 The local model can't read images — offline vision needs Ollama + gemma3:4b.</span>
            <button onClick={() => visionBridge()?.installVisionModel?.()} className="rounded border border-nightjar-accent px-2 py-0.5 text-nightjar-accent hover:bg-nightjar-accent/10">
              Download model
            </button>
            <button onClick={() => visionBridge()?.openOllamaDownload?.()} className="rounded border border-nightjar-accent px-2 py-0.5 text-nightjar-accent hover:bg-nightjar-accent/10">
              Install Ollama
            </button>
            <button onClick={submit} className="rounded bg-nightjar-accent px-2 py-0.5 font-medium text-nightjar-base hover:brightness-110">
              Send anyway
            </button>
            <button onClick={() => setVisionWarn(false)} className="text-nightjar-text/50 hover:underline">cancel</button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <ToolsMenu
            show={menu}
            active={{ research: tools.research, webSearch: tools.webSearch, createImage: createMode }}
            disabled={busy}
            onAddFiles={browse}
            onToggleResearch={() => setTools((t) => ({ ...t, research: !t.research }))}
            onToggleWebSearch={() => setTools((t) => ({ ...t, webSearch: !t.webSearch }))}
            onToggleCreateImage={() => {
              setCreateMode((v) => !v)
              setTools({ research: false, webSearch: false }) // image mode ignores research toggles
            }}
          />
          <button
            onClick={browse}
            disabled={busy}
            title="Attach files"
            aria-label="Attach files"
            className="rounded-lg border border-nightjar-surface px-2.5 py-2 text-lg leading-none text-nightjar-text/70 hover:bg-nightjar-surface disabled:opacity-40"
          >
            📎
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
            rows={1}
            placeholder={createMode ? "Describe the image to create…" : placeholder}
            className="max-h-40 flex-1 resize-none rounded-lg bg-nightjar-surface px-3 py-2 text-nightjar-text placeholder:text-nightjar-text/30 focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
          />
          {busy && onStop ? (
            <button
              onClick={onStop}
              title="Stop — interrupt this session"
              className="rounded-lg border border-nightjar-alert bg-nightjar-alert/15 px-4 py-2 font-medium text-nightjar-alert hover:bg-nightjar-alert/25"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!canSend}
              className="rounded-lg bg-nightjar-accent px-4 py-2 font-medium text-nightjar-base disabled:opacity-40 hover:brightness-110"
            >
              {createMode ? "Create" : "Send"}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
