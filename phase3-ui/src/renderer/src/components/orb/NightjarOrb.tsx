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
import { useEffect, useMemo, useState } from "react"
import { createNightjarOrbAdapter } from "../../lib/orbAdapter"
import { useOrbAdapter } from "../../lib/useOrbAdapter"
import { voice } from "../../lib/voice"
import { CssMiniOrb } from "./CssMiniOrb"
import { VortexOverlay } from "./VortexOverlay"

const DEFAULT_WS =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_NIGHTJAR_WS_URL ||
  "ws://127.0.0.1:8765"

// The Kokoro TTS `speak` tool writes a WAV to a local path and the side-channel
// carries that path. The renderer can't fetch an arbitrary local file, so the
// Electron main process reads the bytes over IPC and we wrap them in a blob URL.
// Deliberately NO file:// fallback: the CSP's `media-src 'self' blob:` refuses the
// file: scheme, so that branch could only ever fail silently (NJ-37) — a missing
// bridge must fail loudly and reach onTtsError instead.
async function loadTtsAudio(path: string): Promise<string> {
  const nj = (window as unknown as { nightjar?: { readAudio?: (p: string) => Promise<ArrayBuffer> } })
    .nightjar
  if (!nj?.readAudio) throw new Error("nightjar.readAudio bridge unavailable")
  const buf = await nj.readAudio(path)
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }))
}

// How long the "audio failed" label stays up. Transient on purpose: the failure is
// per-clip — the pipeline is still alive and the next voice turn may play fine.
const TTS_ERROR_LABEL_MS = 6000

const LABELS: Record<string, string> = {
  idle: "idle",
  connecting: "thinking",
  listening: "listening",
  speaking: "speaking",
  error: "offline",
}

export function NightjarOrb({ wsUrl = DEFAULT_WS, size = 36 }: { wsUrl?: string; size?: number }) {
  const [audioFailed, setAudioFailed] = useState(false)
  const adapter = useMemo(
    // setAudioFailed is a stable setState — safe to close over with [wsUrl] deps.
    () => createNightjarOrbAdapter({ url: wsUrl, loadTtsAudio, onTtsError: () => setAudioFailed(true) }),
    [wsUrl],
  )
  const { state, volume } = useOrbAdapter(adapter)

  // NJ-57: the orb is the always-visible mic indication — while the mic is open it
  // must SAY so ("mic on"), and clicking it is the one-click kill switch. Enabling is
  // deliberately NOT offered here (that goes through Settings' consent modal) — the
  // asymmetry is the point: turning a mic off should be one click, turning it on
  // should be a considered act.
  const [voiceOn, setVoiceOn] = useState<boolean | null>(null)
  useEffect(() => {
    let mounted = true
    voice.get().then((s) => mounted && setVoiceOn(s.enabled))
    const off = voice.onStatus((s) => mounted && setVoiceOn(s.enabled))
    return () => {
      mounted = false
      off()
    }
  }, [])

  // Tear the adapter fully down (WS + audio) when it's replaced or unmounted.
  useEffect(() => () => adapter.disconnect(), [adapter])

  // Auto-clear the failure label; a repeat failure re-arms it.
  useEffect(() => {
    if (!audioFailed) return
    const t = setTimeout(() => setAudioFailed(false), TTS_ERROR_LABEL_MS)
    return () => clearTimeout(t)
  }, [audioFailed])

  // The idle label doubles as the mic indication (NJ-57): "mic on" while listening for
  // the wake word, "voice off" when the daemon is not running. Non-idle states (a live
  // voice turn) keep their pipeline labels.
  const idleLabel = voiceOn === null ? LABELS.idle : voiceOn ? "mic on" : "voice off"
  const label = state === "idle" ? idleLabel : (LABELS[state] ?? state)
  const title = audioFailed
    ? "Voice orb — the reply's audio could not be played (details in the console)"
    : state === "idle" && voiceOn
      ? "Voice orb — mic is ON, listening for the wake word. Click to turn voice off."
      : state === "idle" && voiceOn === false
        ? "Voice orb — voice is off (mic closed). Enable it in Settings."
        : `Voice orb — ${LABELS[state] ?? state}`

  return (
    <>
      <div
        className={`flex flex-col items-center gap-1 ${voiceOn ? "cursor-pointer" : ""}`}
        data-orb-state={state}
        data-orb-audio-failed={audioFailed || undefined}
        data-orb-mic={voiceOn === null ? undefined : voiceOn ? "on" : "off"}
        title={title}
        onClick={() => {
          if (voiceOn) void voice.set(false) // one-click kill switch; enabling lives in Settings
        }}
      >
        <CssMiniOrb state={state} volume={volume} size={size} />
        {audioFailed ? (
          <span className="text-[10px] uppercase tracking-wide text-nightjar-alert">audio failed</span>
        ) : (
          <span
            className={`text-[10px] uppercase tracking-wide ${
              state === "idle" && voiceOn ? "text-nightjar-accent/80" : "text-nightjar-text/40"
            }`}
          >
            {label}
          </span>
        )}
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
