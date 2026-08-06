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
import { useEffect, useMemo, useRef, useState } from "react"
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
  // NJ-63: the adapter's mic gate. A REF, not the voiceOn state value — the adapter is
  // memoized on [wsUrl], so a captured boolean would freeze at whatever voice was when the
  // socket URL last changed. Starts false so an inbound wake that arrives before the first
  // voice.get() resolves cannot open the mic: on a privacy switch, unknown means no.
  const voiceOnRef = useRef(false)
  const adapter = useMemo(
    // setAudioFailed is a stable setState — safe to close over with [wsUrl] deps.
    // micAllowed reads the ref on every call, so it always sees the current preference.
    () =>
      createNightjarOrbAdapter({
        url: wsUrl,
        loadTtsAudio,
        onTtsError: () => setAudioFailed(true),
        micAllowed: () => voiceOnRef.current,
      }),
    [wsUrl],
  )
  const { state, volume } = useOrbAdapter(adapter)

  // NJ-57: the orb is the always-visible mic indication — while the mic is open it
  // must SAY so ("mic on"), and clicking it is the one-click kill switch. Enabling is
  // deliberately NOT offered here (that goes through Settings' consent modal) — the
  // asymmetry is the point: turning a mic off should be one click, turning it on
  // should be a considered act.
  const [voiceOn, setVoiceOn] = useState<boolean | null>(null)
  // NJ-71: the daemon is actually alive. `voiceOn && !micLive` is the state that lied on
  // hardware — pref enabled, daemon crash-looped to `failed`, orb saying "mic on".
  const [micLive, setMicLive] = useState(false)
  // Bugbot PR #158: coming up is not the same as dead. Without this, a normal enable shows
  // "voice failed" for the whole readiness window (90s default).
  const [micStarting, setMicStarting] = useState(false)
  // Stuck mic (Bugbot, PR #151): voice pref is OFF but the daemon's port still
  // answers — the process could not be killed, so the mic may still be LIVE. The
  // orb must warn, never show a false "voice off".
  const [micStuck, setMicStuck] = useState(false)
  useEffect(() => {
    let mounted = true
    const apply = (s: { enabled: boolean; running?: boolean; starting?: boolean; stillListening?: boolean }) => {
      if (!mounted) return
      // Keep the adapter's NJ-63 mic gate in lockstep with the pref, on both the initial
      // voice.get() and every subsequent push. NOTE (NJ-64): this closes the gate for the
      // NEXT wake event; it does not tear down a mic that is already open. That gap is
      // tracked separately.
      voiceOnRef.current = s.enabled
      setVoiceOn(s.enabled)
      setMicLive(Boolean(s.running))
      setMicStarting(Boolean(s.starting))
      setMicStuck(!s.enabled && Boolean(s.stillListening))
    }
    voice.get().then(apply)
    const off = voice.onStatus(apply)
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
  // the wake word, "voice off" when the daemon is not running, and "mic stuck on" when
  // off was requested but the listener would not die. Non-idle states (a live voice
  // turn) keep their pipeline labels.
  // NJ-71: "mic on" requires the pref AND a live daemon. Pref-only says "voice failed" —
  // the daemon died (crash, restart budget exhausted, mic yanked) and nothing is listening,
  // which is exactly what this label claimed otherwise on 2026-08-05.
  // Three outcomes when the pref is on, not two (Bugbot #158): the mic is open, the daemon is
  // still coming up, or it is genuinely dead. Collapsing the middle case into "voice failed"
  // would slander a normal enable for up to the 90s readiness window.
  const idleLabel = micStuck
    ? "mic stuck on"
    : voiceOn === null
      ? LABELS.idle
      : voiceOn
        ? micLive
          ? "mic on"
          : micStarting
            ? "starting…"
            : "voice failed"
        : "voice off"
  const label = state === "idle" ? idleLabel : (LABELS[state] ?? state)
  const title = micStuck
    ? "Voice orb — voice was turned OFF but something is still listening on the voice port; the mic may still be live. Check the health strip or stop the process manually."
    : audioFailed
      ? "Voice orb — the reply's audio could not be played (details in the console)"
      : state === "idle" && voiceOn && micLive
        ? "Voice orb — mic is ON, listening for the wake word. Click to turn voice off."
        : state === "idle" && voiceOn && micStarting
          ? "Voice orb — voice is ON and the listener is starting up. The mic is not open yet."
          : state === "idle" && voiceOn && !micLive
            ? // NJ-71: voice is switched on but the capture process is NOT running. Say so
              // rather than claiming an open mic, and point at where the reason is visible.
              "Voice orb — voice is ON but the listener is not running (it failed to start or crashed). No microphone is open. Check wake-daemon in the health strip."
            : state === "idle" && voiceOn === false
            ? "Voice orb — voice is off (mic closed). Enable it in Settings."
            : `Voice orb — ${LABELS[state] ?? state}`

  return (
    <>
      <div
        className={`flex flex-col items-center gap-1 ${voiceOn ? "cursor-pointer" : ""}`}
        data-orb-state={state}
        data-orb-audio-failed={audioFailed || undefined}
        // NJ-71: reports the MICROPHONE, not the preference — "on" only with a live daemon.
        // Tests and any future automation read this attribute, so it must not lie either.
        data-orb-mic={voiceOn === null ? undefined : voiceOn && micLive ? "on" : "off"}
        title={title}
        onClick={() => {
          if (voiceOn) void voice.set(false) // one-click kill switch; enabling lives in Settings
        }}
      >
        <CssMiniOrb state={state} volume={volume} size={size} />
        {audioFailed || (micStuck && state === "idle") ? (
          <span className="text-[10px] uppercase tracking-wide text-nightjar-alert">
            {audioFailed ? "audio failed" : "mic stuck on"}
          </span>
        ) : (
          <span
            // Bugbot PR #158: the colour must follow the MICROPHONE, not the preference.
            // Keyed on `voiceOn` alone, a dead daemon rendered "voice failed" in the accent
            // highlight — visually identical to a live mic, which is the same lie the label
            // was fixed for. Accent only when actually listening; alert when genuinely dead;
            // muted while coming up or off.
            className={`text-[10px] uppercase tracking-wide ${
              state === "idle" && voiceOn && micLive
                ? "text-nightjar-accent/80"
                : state === "idle" && voiceOn && !micStarting
                  ? "text-nightjar-alert"
                  : "text-nightjar-text/40"
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
