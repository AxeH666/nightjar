// NightjarOrb — the voice-reactive orb in the header (Phase 4), plus the
// Siri-style full-screen overlay (Phase 4 follow-up) that takes over whenever
// the pipeline is actually active.
//
// Replaces the static amber placeholder disc. Builds a NightjarOrbAdapter (the
// custom orb-ui adapter wired to the :8765 side-channel + Web Audio), bridges it
// into React with useOrbAdapter, and renders orb-ui's circle theme — forked to
// Nightjar amber — in controlled mode: `<AmberCircleTheme state volume />`. The
// small header orb and the OrbOverlay share this one adapter subscription (one
// side-channel connection, one set of audio analysers) so both stay in sync.
import { useEffect, useMemo } from "react"
import { createNightjarOrbAdapter } from "../../lib/orbAdapter"
import { useOrbAdapter } from "../../lib/useOrbAdapter"
import { AmberCircleTheme } from "./AmberCircleTheme"
import { OrbOverlay } from "./OrbOverlay"

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
        <AmberCircleTheme state={state} volume={volume} size={size} />
        <span className="text-[10px] uppercase tracking-wide text-nightjar-text/40">
          {LABELS[state] ?? state}
        </span>
      </div>
      <OrbOverlay state={state} volume={volume} active={state !== "idle"} />
    </>
  )
}
