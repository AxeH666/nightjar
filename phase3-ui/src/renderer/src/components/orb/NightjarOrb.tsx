// NightjarOrb — the voice-reactive orb in the header (Phase 4), plus the
// Siri-style full-screen overlay (Phase 4 follow-up) that takes over whenever
// the pipeline is actually active.
//
// Builds a NightjarOrbAdapter (wired to the :8765 side-channel + Web Audio),
// bridges it into React with useOrbAdapter, and renders the custom orb: a cheap
// CSS mini-orb in the header (always on) plus the WebGL VortexOverlay that takes
// over during a voice turn. Both share this one adapter subscription (one
// side-channel connection, one set of audio analysers) so they stay in sync.
// (Stage 7: replaced the orb-ui circle-theme fork with the Three.js vortex.)
import { useEffect, useMemo } from "react"
import { createNightjarOrbAdapter } from "../../lib/orbAdapter"
import { useOrbAdapter } from "../../lib/useOrbAdapter"
import { CssMiniOrb } from "./CssMiniOrb"
import { VortexOverlay } from "./VortexOverlay"

const DEFAULT_WS =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_NIGHTJAR_WS_URL ||
  "ws://127.0.0.1:8765"

// The Kokoro TTS `speak` tool writes a WAV to a local path and the side-channel
// carries that path. The renderer can't fetch an arbitrary local file, so the
// Electron main process reads the bytes over IPC and we wrap them in a blob URL.
async function loadTtsAudio(path: string): Promise<string> {
  const nj = (window as unknown as { nightjar?: { readAudio?: (p: string) => Promise<ArrayBuffer> } })
    .nightjar
  if (nj?.readAudio) {
    const buf = await nj.readAudio(path)
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }))
  }
  return path.startsWith("file:") ? path : `file://${path}`
}

const LABELS: Record<string, string> = {
  idle: "idle",
  connecting: "thinking",
  listening: "listening",
  speaking: "speaking",
  error: "offline",
}

export function NightjarOrb({ wsUrl = DEFAULT_WS, size = 36 }: { wsUrl?: string; size?: number }) {
  const adapter = useMemo(
    () => createNightjarOrbAdapter({ url: wsUrl, loadTtsAudio }),
    [wsUrl],
  )
  const { state, volume } = useOrbAdapter(adapter)

  // Tear the adapter fully down (WS + audio) when it's replaced or unmounted.
  useEffect(() => () => adapter.disconnect(), [adapter])

  return (
    <>
      <div
        className="flex flex-col items-center gap-1"
        data-orb-state={state}
        title={`Voice orb — ${LABELS[state] ?? state}`}
      >
        <CssMiniOrb state={state} volume={volume} size={size} />
        <span className="text-[10px] uppercase tracking-wide text-nightjar-text/40">
          {LABELS[state] ?? state}
        </span>
      </div>
      {/* The full-screen overlay takes over only during a REAL voice turn
          (connecting/listening/speaking). "error" ("voice offline", e.g. the
          side-channel dropped) is a PASSIVE background status — surfaced by the
          header mini-orb's color — and must NOT open the input-capturing overlay,
          which would otherwise block the entire app until voice reconnects. */}
      <VortexOverlay state={state} volume={volume} active={state !== "idle" && state !== "error"} />
    </>
  )
}
