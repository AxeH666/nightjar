import { useEffect, useState } from "react"

// Local vision (offline image analysis via Ollama gemma3:4b) status, mirroring the
// main-process type. Renders nothing when vision is ready; otherwise a thin banner
// with download progress or a one-click setup path. Cloud vision (BYOK) is unaffected.
interface VisionStatus {
  ollama: "running" | "installed" | "absent"
  model: "present" | "missing" | "pulling" | "unknown"
  pct?: number
  detail?: string
}
interface VisionBridge {
  getVisionStatus(): Promise<VisionStatus>
  installVisionModel(): Promise<VisionStatus>
  openOllamaDownload(): Promise<void>
  onVisionStatus(cb: (s: VisionStatus) => void): () => void
}
function bridge(): VisionBridge | null {
  return (window as unknown as { nightjar?: VisionBridge }).nightjar ?? null
}

const BAR = "flex items-center gap-3 border-b border-nightjar-surface/70 bg-nightjar-surface/40 px-4 py-1.5 text-xs text-nightjar-text/70"
const BTN = "rounded border border-nightjar-accent px-2 py-0.5 text-nightjar-accent hover:bg-nightjar-accent/10"

export function VisionBanner() {
  const [st, setSt] = useState<VisionStatus | null>(null)
  useEffect(() => {
    const b = bridge()
    if (!b) return
    b.getVisionStatus?.().then(setSt).catch(() => {})
    return b.onVisionStatus?.(setSt)
  }, [])

  if (!st) return null
  if (st.ollama === "running" && st.model === "present") return null // ready → silent

  if (st.model === "pulling") {
    return (
      <div className={BAR}>
        <span>
          ⬇ Downloading offline vision model (gemma3:4b)
          {typeof st.pct === "number" ? ` — ${st.pct}%` : ""}
          {st.detail ? ` · ${st.detail}` : ""}
        </span>
      </div>
    )
  }
  if (st.ollama === "absent") {
    return (
      <div className={BAR}>
        <span>
          👁 Offline image analysis needs <b>Ollama</b> (cloud vision still works with a BYOK key).
        </span>
        <button onClick={() => bridge()?.openOllamaDownload()} className={BTN}>
          Install Ollama
        </button>
      </div>
    )
  }
  if (st.ollama === "installed") {
    return (
      <div className={BAR}>
        <span>👁 Ollama is installed but its daemon isn't running yet — starting…</span>
      </div>
    )
  }
  if (st.model === "missing") {
    return (
      <div className={BAR}>
        <span>👁 Local vision model isn't downloaded.</span>
        <button onClick={() => bridge()?.installVisionModel()} className={BTN}>
          Download gemma3:4b (~3.3 GB)
        </button>
      </div>
    )
  }
  return null
}
