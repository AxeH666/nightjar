// Nightjar OrbAdapter (Phase 4).
//
// Nightjar's `OrbAdapter` implementation (contract in ./orbTypes — the shape orb-ui
// shipped for its Vapi / ElevenLabs adapters: `subscribe({onStateChange,
// onVolumeChange})` + start/stop), wired to Nightjar's own signals:
//
//   • STATE comes off the Phase-2 side-channel WebSocket (ws://127.0.0.1:8765):
//       wake            → 'listening'   (openWakeWord fired: "Hey Nightjar")
//       transcription   → 'connecting'  (command captured; agent is thinking)
//       tts (ready+path)→ 'speaking'    (Kokoro WAV; we play it in the renderer)
//       playback ended  → 'idle'
//     WS lost/failed    → 'error' (auto-reconnects; returns to 'idle' on reopen)
//
//   • VOLUME is measured in the renderer with the Web Audio API:
//       listening → AnalyserNode over the mic MediaStream
//       speaking  → AnalyserNode over the Kokoro TTS <audio> output
//     (getByteFrequencyData → RMS → EMA → normalize; see audioVolume.ts)
//
// Every browser dependency (WebSocket, AudioContext, getUserMedia, <audio>, and
// the local-file→URL step for the TTS WAV) is injectable, so the whole state
// machine is drivable headlessly in tests and against the real :8765 hub.

import type { OrbAdapter, OrbState } from "./orbTypes"
import {
  AudioLevelMonitor,
  defaultScheduler,
  type AudioCtxLike,
  type FrameScheduler,
} from "./audioVolume"

// ─── Side-channel event shape (see phase2-mcp/mcp_server.py `_publish`) ───────

export interface SideChannelEvent {
  kind: string
  // wake
  detected?: boolean
  max_score?: number
  // transcription
  text?: string
  final?: boolean
  // tts
  state?: string
  path?: string
  // marks events this adapter itself published, so we never react to our echoes
  source?: string
}

export interface AdapterCallbacks {
  onStateChange: (state: OrbState) => void
  onVolumeChange: (volume: number) => void
}

// ─── Injectable environment ───────────────────────────────────────────────────

export interface NightjarOrbAdapterOptions {
  /** Side-channel hub. Default ws://127.0.0.1:8765. */
  url?: string
  /** WebSocket implementation (default: global WebSocket — present in browsers, Electron, and Node ≥22/bun). */
  WebSocketImpl?: typeof WebSocket
  /** AudioContext factory for the volume analysers. Default: `() => new AudioContext()`. */
  createAudioContext?: () => AudioCtxLike
  /** Mic acquisition. Default: `navigator.mediaDevices.getUserMedia`. */
  getUserMedia?: (constraints: unknown) => Promise<unknown>
  /**
   * NJ-63 — is the renderer allowed to open the microphone right now?
   *
   * The side-channel hub (ws://127.0.0.1:8765) has no auth, no origin check, and no
   * producer/consumer split: ANY local process can publish, and a `wake` event drove
   * `enterListening()` → `startMic()` → `getUserMedia({audio:true})` with nothing
   * consulting the user's voice preference. That was a SECOND mic-open path, entirely
   * around the consent gate PR #151 added — that gate governs the wake-daemon PROCESS
   * (supervisor `enabled()`), which is a different process holding a different mic handle.
   *
   * Must be a live GETTER, not a boolean: the app's adapter is built inside a useMemo
   * keyed on the socket URL, so a captured value would go stale the moment the user
   * toggled voice. Defaults to "allowed" so headless harnesses that inject their own
   * getUserMedia keep working; the app always supplies the real one.
   */
  micAllowed?: () => boolean
  /** <audio> element factory for TTS playback. Default: `() => new Audio()`. */
  createAudioElement?: () => HTMLAudioElement
  /** Resolve a Kokoro WAV path (from the `tts` event) to a URL the <audio> can play. */
  loadTtsAudio?: (path: string) => Promise<string>
  /** Called when a TTS clip fails to load or play (readAudio bridge missing, <audio>
   *  element error, refused play()). Lets the UI surface the failure visibly —
   *  swallowing it into silent silence was NJ-37. Never called for clips that were
   *  superseded by a newer one (that's normal turn flow, not a failure). */
  onTtsError?: (err: unknown) => void
  /** Frame scheduler for the analyser loops (default requestAnimationFrame). */
  scheduler?: FrameScheduler
  /** Reconnect backoff for the side-channel. Default 2000ms. */
  reconnectMs?: number
  /** Auto-revert 'listening' → 'idle' if no transcription arrives. Default 15000ms. */
  listeningTimeoutMs?: number
  /** Auto-revert 'connecting' → 'idle' if no TTS arrives (text-only reply). Default 30000ms. */
  thinkingTimeoutMs?: number
  /** Force 'speaking' → 'idle' if a TTS clip's onended/onerror never fire (hung playback). Default 60000ms. */
  speakingTimeoutMs?: number
  /** Publish tts playing/ended back to the side-channel so it reflects real playback. Default true. */
  publishPlayback?: boolean
}

export interface NightjarOrbAdapter extends OrbAdapter {
  /** Current orb state (also pushed to every subscriber). */
  getState(): OrbState
  /** Open the side-channel connection (also done automatically on first subscribe). */
  connect(): void
  /** Close the side-channel connection and tear down audio. */
  disconnect(): void
}

const DEFAULT_URL = "ws://127.0.0.1:8765"

type TimerHandle = ReturnType<typeof setTimeout>

export function createNightjarOrbAdapter(
  options: NightjarOrbAdapterOptions = {},
): NightjarOrbAdapter {
  const url = options.url ?? DEFAULT_URL
  const WS = options.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket
  const scheduler = options.scheduler ?? defaultScheduler()
  const reconnectMs = options.reconnectMs ?? 2000
  const listeningTimeoutMs = options.listeningTimeoutMs ?? 15000
  const thinkingTimeoutMs = options.thinkingTimeoutMs ?? 30000
  const speakingTimeoutMs = options.speakingTimeoutMs ?? 60000
  const publishPlayback = options.publishPlayback ?? true

  const createAudioContext =
    options.createAudioContext ??
    (() => new (globalThis as unknown as { AudioContext: new () => AudioCtxLike }).AudioContext())
  const getUserMedia =
    options.getUserMedia ??
    ((constraints: unknown) =>
      (navigator.mediaDevices.getUserMedia as (c: unknown) => Promise<unknown>)(constraints))
  const createAudioElement = options.createAudioElement ?? (() => new Audio())
  const micAllowed = options.micAllowed ?? (() => true)
  // No file:// default: the renderer CSP (`media-src 'self' blob:`) refuses the file:
  // scheme, so a file:// URL could only ever fail silently (NJ-37). A caller that
  // doesn't inject a real resolver (the app wires readAudio IPC → blob: URL) gets a
  // loud rejection routed through onTtsError instead of inaudible "playback".
  const loadTtsAudio =
    options.loadTtsAudio ??
    (async (path: string): Promise<string> => {
      throw new Error(`no loadTtsAudio resolver provided — cannot play ${path}`)
    })
  const onTtsError = options.onTtsError

  // ── subscriber fan-out (mirrors orb-ui's ElevenLabs adapter) ────────────────
  const subscribers = new Set<AdapterCallbacks>()
  let state: OrbState = "idle"

  function setState(next: OrbState): void {
    if (next === state) return
    state = next
    subscribers.forEach((cb) => cb.onStateChange(next))
  }
  function emitVolume(v: number): void {
    subscribers.forEach((cb) => cb.onVolumeChange(v))
  }

  // ── audio: mic (listening) + tts (speaking) ─────────────────────────────────
  const micMonitor = new AudioLevelMonitor({ createAudioContext, scheduler })
  const ttsMonitor = new AudioLevelMonitor({ createAudioContext, scheduler })
  let micStream: { getTracks(): { stop(): void; readonly readyState?: string }[] } | null = null
  let micStarting = false
  let ttsAudio: HTMLAudioElement | null = null
  let ttsUrl: string | null = null
  let ttsPlayId = 0 // monotonic token — any teardown bumps it, invalidating an in-flight playTts load (B11)

  // ── side-channel connection ─────────────────────────────────────────────────
  let ws: WebSocket | null = null
  let everOpened = false
  let closedByUs = false
  let reconnectTimer: TimerHandle | null = null

  // ── lifecycle timers ────────────────────────────────────────────────────────
  let listeningTimer: TimerHandle | null = null
  let thinkingTimer: TimerHandle | null = null
  let speakingTimer: TimerHandle | null = null
  function clearTimer(t: TimerHandle | null): null {
    if (t) clearTimeout(t)
    return null
  }

  // ── mic ─────────────────────────────────────────────────────────────────────
  async function startMic(): Promise<void> {
    if (micStream || micStarting) return
    // NJ-63 choke point. Every path to the renderer's microphone passes through here, so
    // the check lives here as well as at the wake case — a future caller that reaches
    // startMic another way must not bypass the user's voice preference.
    if (!micAllowed()) {
      console.warn("[nightjar-orb] refusing to open the mic: voice is not enabled")
      return
    }
    micStarting = true
    try {
      const stream = (await getUserMedia({ audio: true })) as typeof micStream & object
      // If we left the listening state while awaiting the mic, drop it.
      if (state !== "listening") {
        ;(stream as unknown as { getTracks(): { stop(): void }[] })
          .getTracks()
          .forEach((t) => t.stop())
        return
      }
      micStream = stream as unknown as typeof micStream
      micMonitor.attachStream(stream)
      micMonitor.start(emitVolume)
    } catch (err) {
      // No mic / permission denied: stay in 'listening', volume just stays flat.
      console.warn("[nightjar-orb] mic unavailable:", err)
    } finally {
      micStarting = false
    }
  }

  function stopMic(): void {
    micMonitor.stop()
    if (micStream) {
      micStream.getTracks().forEach((t) => {
        if (t.readyState !== "ended") t.stop()
      })
      micStream = null
    }
    emitVolume(0)
  }

  // ── tts playback ─────────────────────────────────────────────────────────────
  function teardownTts(): void {
    ttsPlayId++ // invalidate any in-flight playTts load (from a newer playTts / enterListening / stop / disconnect) — B11
    speakingTimer = clearTimer(speakingTimer) // drop the hung-clip watchdog for the clip being torn down
    ttsMonitor.stop()
    if (ttsAudio) {
      try {
        ttsAudio.pause()
      } catch {
        /* noop */
      }
      ttsAudio.onended = null
      ttsAudio.onerror = null
      ttsAudio.onplaying = null
      ttsAudio = null
    }
    if (ttsUrl && ttsUrl.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(ttsUrl)
      } catch {
        /* noop */
      }
    }
    ttsUrl = null
  }

  function endTts(toState: OrbState): void {
    teardownTts()
    emitVolume(0)
    if (publishPlayback) publish({ kind: "tts", state: "ended", source: "orb-ui" })
    setState(toState)
  }

  async function playTts(path: string): Promise<void> {
    listeningTimer = clearTimer(listeningTimer)
    thinkingTimer = clearTimer(thinkingTimer)
    stopMic()
    teardownTts() // bumps ttsPlayId
    const myId = ttsPlayId // capture AFTER teardown; a later teardown/playTts makes this run stale
    let url: string
    try {
      url = await loadTtsAudio(path)
    } catch (err) {
      console.warn("[nightjar-orb] could not load TTS audio:", err)
      if (myId === ttsPlayId) {
        onTtsError?.(err)
        setState("idle") // only if we're still the active run
      }
      return
    }
    // Superseded while loading (a second 'ready' event, enterListening, stop, …) →
    // discard this clip so it can't leak its URL or clobber the winning playback (B11).
    if (myId !== ttsPlayId) {
      if (url.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(url)
        } catch {
          /* noop */
        }
      }
      return
    }
    const audio = createAudioElement()
    ttsAudio = audio
    ttsUrl = url
    audio.src = url
    audio.onplaying = () => {
      setState("speaking")
      if (publishPlayback) publish({ kind: "tts", state: "playing", source: "orb-ui" })
      ttsMonitor.attachElement(audio)
      ttsMonitor.start(emitVolume)
      // Watchdog: if this clip's onended/onerror never fire (hung playback), the overlay would
      // stay in 'speaking' forever and lock input. Force back to idle after speakingTimeoutMs (P2-18).
      speakingTimer = clearTimer(speakingTimer)
      speakingTimer = setTimeout(() => {
        if (state === "speaking") endTts("idle")
      }, speakingTimeoutMs)
    }
    audio.onended = () => endTts("idle")
    // teardownTts nulls this handler, so only the ACTIVE clip can report a failure.
    audio.onerror = () => {
      onTtsError?.(new Error("TTS <audio> playback error"))
      endTts("idle")
    }
    try {
      await audio.play()
    } catch (err) {
      console.warn("[nightjar-orb] TTS playback failed:", err)
      if (myId === ttsPlayId) {
        onTtsError?.(err)
        endTts("idle") // don't let a superseded run tear down the winner
      }
    }
  }

  // ── state transitions off the pipeline ───────────────────────────────────────
  function enterListening(): void {
    thinkingTimer = clearTimer(thinkingTimer)
    teardownTts()
    setState("listening")
    listeningTimer = clearTimer(listeningTimer)
    listeningTimer = setTimeout(() => {
      if (state === "listening") {
        stopMic()
        setState("idle")
      }
    }, listeningTimeoutMs)
    void startMic()
  }

  function enterThinking(): void {
    listeningTimer = clearTimer(listeningTimer)
    stopMic()
    setState("connecting")
    thinkingTimer = clearTimer(thinkingTimer)
    thinkingTimer = setTimeout(() => {
      if (state === "connecting") setState("idle")
    }, thinkingTimeoutMs)
  }

  function handleEvent(ev: SideChannelEvent): void {
    if (!ev || typeof ev.kind !== "string") return
    switch (ev.kind) {
      case "wake":
        // NJ-63: with voice disabled there is no legitimate producer of `wake` — the
        // daemon is not running — so any such frame is forged or stale. Drop it before
        // it can change state, rather than entering 'listening' with a mic we then
        // refuse to open (which would show a listening orb that isn't listening).
        if (!micAllowed()) {
          console.warn("[nightjar-orb] ignoring a wake event: voice is not enabled")
          break
        }
        if (ev.detected !== false) enterListening()
        break
      case "transcription":
        // A final transcript means the command is captured → agent is working.
        if (ev.final !== false) enterThinking()
        break
      case "tts":
        // Only a freshly-synthesized clip drives playback; our own
        // playing/ended echoes (and any other producer's) are ignored.
        if (ev.state === "ready" && typeof ev.path === "string" && ev.source !== "orb-ui") {
          void playTts(ev.path)
        }
        break
      // browser_state and anything else: not orb-relevant.
    }
  }

  // ── side-channel plumbing ─────────────────────────────────────────────────────
  function publish(event: SideChannelEvent): void {
    if (ws && ws.readyState === 1 /* OPEN */) {
      try {
        ws.send(JSON.stringify({ type: "publish", event }))
      } catch {
        /* best effort */
      }
    }
  }

  function scheduleReconnect(): void {
    if (closedByUs || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      openSocket()
    }, reconnectMs)
  }

  function openSocket(): void {
    if (!WS) {
      console.warn("[nightjar-orb] no WebSocket implementation available")
      return
    }
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return
    closedByUs = false
    let sock: WebSocket
    try {
      sock = new WS(url)
    } catch (err) {
      console.warn("[nightjar-orb] side-channel connect failed:", err)
      scheduleReconnect()
      return
    }
    ws = sock
    sock.onopen = () => {
      everOpened = true
      // Recover from a prior 'error' flash once we're back.
      if (state === "error") setState("idle")
    }
    sock.onmessage = (msg: MessageEvent) => {
      let frame: { type?: string; event?: SideChannelEvent; state?: Record<string, SideChannelEvent> }
      try {
        frame = JSON.parse(typeof msg.data === "string" ? msg.data : String(msg.data))
      } catch {
        return
      }
      if (frame.type === "event" && frame.event) handleEvent(frame.event)
      // 'snapshot' frames (latest-per-kind on connect) are intentionally not
      // replayed: they describe past state, not a live transition to animate.
    }
    sock.onerror = () => {
      // onclose handles reconnect/state; keep this quiet to avoid double work.
    }
    sock.onclose = () => {
      ws = null
      if (closedByUs) return
      // Only surface 'error' if we had a working link that dropped, and we're
      // not mid-flow (don't stomp an active listening/speaking animation).
      if (everOpened && (state === "idle" || state === "connecting")) setState("error")
      scheduleReconnect()
    }
  }

  function connect(): void {
    openSocket()
  }

  function disconnect(): void {
    closedByUs = true
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    listeningTimer = clearTimer(listeningTimer)
    thinkingTimer = clearTimer(thinkingTimer)
    stopMic()
    teardownTts()
    if (ws) {
      const sock = ws
      ws = null
      try {
        sock.close()
      } catch {
        /* noop */
      }
    }
    void micMonitor.dispose()
    void ttsMonitor.dispose()
    setState("idle")
  }

  // ── OrbAdapter surface ────────────────────────────────────────────────────────
  return {
    getState: () => state,
    connect,
    disconnect,

    subscribe(callbacks: AdapterCallbacks) {
      subscribers.add(callbacks)
      // hand the new subscriber the current state immediately
      callbacks.onStateChange(state)
      if (subscribers.size === 1) connect()
      return () => {
        subscribers.delete(callbacks)
        if (subscribers.size === 0) disconnect()
      }
    },

    // Clickable-orb lifecycle (optional; the pipeline is otherwise always-on).
    start() {
      connect()
    },
    stop() {
      // Cancel whatever is in flight and go quiet.
      listeningTimer = clearTimer(listeningTimer)
      thinkingTimer = clearTimer(thinkingTimer)
      stopMic()
      teardownTts()
      setState("idle")
    },
  }
}
