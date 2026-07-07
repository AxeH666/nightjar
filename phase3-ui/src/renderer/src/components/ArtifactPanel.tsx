import { useEffect, useRef, useState } from "react"
import { previewBridge, isRenderable, fmtSize, type PreviewEntry } from "../lib/preview"

// Live-preview / Artifacts panel (AUDIT §10 #4). Split-view alongside chat: renders
// the coding agent's generated files live in a sandboxed iframe (served by the
// loopback static server), with a synchronized streaming Code view and a Files tab
// with Download (any type) + Reveal. Mirrors the app's tactical theme.
interface Props {
  sessionID: string
  entry: string // active file (workspace-relative) to preview
  nonce: number // bumped on each mirror write → cache-busts the iframe
  live: { rel: string; content: string; streaming: boolean } | null // Code tab buffer
  onSelectEntry: (rel: string) => void
  onClose: () => void
  className?: string
}

type Tab = "preview" | "code" | "files"

const TAB_BTN = (active: boolean): string =>
  `px-3 py-1 text-xs rounded ${active ? "bg-nightjar-accent text-nightjar-base" : "text-nightjar-text/60 hover:text-nightjar-text"}`

// Decode a base64 data URL (from previewRead) to UTF-8 text for the source view.
function dataUrlToText(dataUrl: string): string {
  const b64 = dataUrl.split(",")[1] ?? ""
  try {
    const bin = atob(b64)
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    return ""
  }
}

export function ArtifactPanel({ sessionID, entry, nonce, live, onSelectEntry, onClose, className }: Props) {
  const [tab, setTab] = useState<Tab>("preview")
  const [src, setSrc] = useState<string>("")
  const [files, setFiles] = useState<PreviewEntry[]>([])
  const [selectedSource, setSelectedSource] = useState<string>("") // Code view of a non-streaming file
  const codeRef = useRef<HTMLPreElement | null>(null)
  const b = previewBridge()

  // The Code tab shows the streaming buffer only while THAT file is the active entry;
  // otherwise it shows the selected file's actual source (fetched), so picking another
  // file or viewing an edited file no longer shows the last streamed write (Bugbot).
  const showLive = !!live && live.rel === entry
  const codeText = showLive ? live.content : selectedSource
  useEffect(() => {
    if (!b || !entry || showLive) return
    let alive = true
    b.read(sessionID, entry).then(({ dataUrl }) => alive && setSelectedSource(dataUrlToText(dataUrl))).catch(() => alive && setSelectedSource(""))
    return () => {
      alive = false
    }
  }, [b, sessionID, entry, showLive, nonce])

  // Resolve the preview URL for the active entry (async IPC), then cache-bust with nonce.
  useEffect(() => {
    let alive = true
    if (!b || !entry || !isRenderable(entry)) {
      setSrc("")
      return
    }
    b.url(sessionID, entry).then((u) => alive && setSrc(u)).catch(() => {})
    return () => {
      alive = false
    }
  }, [b, sessionID, entry])

  // Refresh the file list whenever a new mirror write lands (nonce bump).
  useEffect(() => {
    b?.list(sessionID).then(setFiles).catch(() => {})
  }, [b, sessionID, nonce])

  // Choreography: jump to Code while a file streams, back to Preview when it settles.
  const wasStreaming = useRef(false)
  useEffect(() => {
    if (live?.streaming) {
      wasStreaming.current = true
      setTab("code")
    } else if (wasStreaming.current) {
      wasStreaming.current = false
      const t = setTimeout(() => setTab(entry && isRenderable(entry) ? "preview" : "files"), 1200)
      return () => clearTimeout(t)
    }
  }, [live?.streaming, entry])

  // Follow the streaming code to the bottom.
  useEffect(() => {
    if (tab === "code" && showLive && codeRef.current) codeRef.current.scrollTop = codeRef.current.scrollHeight
  }, [codeText, tab, showLive])

  const iframeSrc = src ? `${src}${src.includes("?") ? "&" : "?"}v=${nonce}` : ""

  return (
    <section className={`flex flex-col bg-nightjar-base ${className ?? ""}`}>
      <header className="flex items-center gap-2 border-b border-nightjar-surface px-3 py-1.5">
        <span className="text-xs font-semibold text-nightjar-accent">Preview</span>
        <div className="flex items-center gap-1">
          <button className={TAB_BTN(tab === "preview")} onClick={() => setTab("preview")}>Preview</button>
          <button className={TAB_BTN(tab === "code")} onClick={() => setTab("code")}>
            Code{live?.streaming ? " ●" : ""}
          </button>
          <button className={TAB_BTN(tab === "files")} onClick={() => setTab("files")}>
            Files{files.length ? ` (${files.length})` : ""}
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {entry && (
            <button
              className="text-xs text-nightjar-text/50 hover:text-nightjar-text"
              title="Reveal in file manager"
              onClick={() => b?.reveal(sessionID, entry)}
            >
              Reveal
            </button>
          )}
          <button className="text-nightjar-text/50 hover:text-nightjar-text" title="Close preview" onClick={onClose}>
            ✕
          </button>
        </div>
      </header>

      {/* Preview */}
      {tab === "preview" && (
        <div className="min-h-0 flex-1 bg-white">
          {iframeSrc ? (
            <iframe
              key={entry}
              title="artifact-preview"
              src={iframeSrc}
              sandbox="allow-scripts allow-forms"
              referrerPolicy="no-referrer"
              className="h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-nightjar-base p-6 text-center text-sm text-nightjar-text/50">
              {entry
                ? `No visual preview for “${entry}” — view the Code tab or Download it.`
                : "No preview yet — generate something to see it render here."}
            </div>
          )}
        </div>
      )}

      {/* Code (streaming source of the active/last file) */}
      {tab === "code" && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="border-b border-nightjar-surface px-3 py-1 font-mono text-[11px] text-nightjar-text/50">
            {entry || live?.rel || "—"}
          </div>
          <pre
            ref={codeRef}
            className="h-full overflow-auto px-3 py-2 font-mono text-[12px] leading-relaxed text-nightjar-text/90"
          >
            {codeText}
            {showLive && live?.streaming && <span className="animate-pulse text-nightjar-accent">▍</span>}
          </pre>
        </div>
      )}

      {/* Files (list + download + reveal) */}
      {tab === "files" && (
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {files.length === 0 && <div className="p-3 text-sm text-nightjar-text/50">No files yet.</div>}
          {files.map((f) => (
            <div
              key={f.path}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-nightjar-surface/50"
            >
              <button
                className={`min-w-0 flex-1 truncate text-left font-mono text-[12px] ${
                  f.path === entry ? "text-nightjar-accent" : "text-nightjar-text/80 hover:text-nightjar-text"
                }`}
                title={f.path}
                onClick={() => {
                  onSelectEntry(f.path)
                  setTab(isRenderable(f.path) ? "preview" : "code")
                }}
              >
                {f.path}
              </button>
              <span className="shrink-0 text-[11px] text-nightjar-text/40">{fmtSize(f.size)}</span>
              <button
                className="shrink-0 rounded border border-nightjar-accent px-2 py-0.5 text-[11px] text-nightjar-accent hover:bg-nightjar-accent/10"
                onClick={() => b?.saveAs(sessionID, f.path)}
              >
                Download
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
