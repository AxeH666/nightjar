// Phase 4 orb test — drives the ACTUAL Nightjar orb modules:
//   - src/renderer/src/lib/audioVolume.ts   (RMS reduction + AnalyserNode monitor)
//   - src/renderer/src/lib/orbAdapter.ts     (the custom orb-ui OrbAdapter)
//
// Three layers:
//   1. Unit — pure RMS/normalize math on known buffers.
//   2. Unit — AudioLevelMonitor + full adapter state machine, with mocked Web
//      Audio / <audio> / WebSocket (headless: no sound card, no DOM here).
//   3. Integration — the adapter's REAL WebSocket path against the REAL running
//      side-channel hub on :8765, driven by real publish frames.
//
// Run with: bun test-orb.ts   (bun/Node ≥22 provide a global WebSocket)
import {
  rmsFromByteFrequency,
  normalizeVolume,
  AudioLevelMonitor,
  type FrameScheduler,
} from "./src/renderer/src/lib/audioVolume"
import { createNightjarOrbAdapter } from "./src/renderer/src/lib/orbAdapter"

const HUB = process.env.NIGHTJAR_WS_URL || "ws://127.0.0.1:8765"
let pass = 0
let fail = 0
const check = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${extra ? ` — ${extra}` : ""}`)
  ok ? pass++ : fail++
}
const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms))
async function waitFor(pred: () => boolean, timeoutMs = 2000, stepMs = 20): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (pred()) return true
    await flush(stepMs)
  }
  return pred()
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Manual frame clock — tick() runs currently-queued callbacks once each.
class MockScheduler implements FrameScheduler {
  private cbs = new Map<number, () => void>()
  private id = 1
  schedule(cb: () => void): number {
    const h = this.id++
    this.cbs.set(h, cb)
    return h
  }
  cancel(h: number): void {
    this.cbs.delete(h)
  }
  tick(times = 1): void {
    for (let i = 0; i < times; i++) {
      const snapshot = [...this.cbs.values()]
      this.cbs.clear()
      for (const cb of snapshot) cb()
    }
  }
}

// Mock AudioContext whose analyser reports a shared, test-controlled level.
function makeMockAudioContext(level: { value: number }) {
  return () => ({
    state: "running",
    createAnalyser: () => ({
      fftSize: 256,
      frequencyBinCount: 128,
      getByteFrequencyData: (arr: Uint8Array) => arr.fill(level.value),
    }),
    createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
    createMediaElementSource: () => ({ connect: () => {}, disconnect: () => {} }),
    destination: {},
    resume: async () => {},
    close: async () => {},
  })
}

function makeMockStream() {
  const tracks = [{ stop: () => {}, readyState: "live" }]
  return { getTracks: () => tracks }
}

class MockAudio {
  src = ""
  paused = true
  onplaying: null | (() => void) = null
  onended: null | (() => void) = null
  onerror: null | (() => void) = null
  async play() {
    this.paused = false
    queueMicrotask(() => this.onplaying?.())
  }
  pause() {
    this.paused = true
  }
  fireEnded() {
    this.onended?.()
  }
}

// Mock WebSocket the adapter constructs; the test drives open/message/close.
class MockWS {
  static last: MockWS | null = null
  static instances = 0
  readyState = 0
  onopen: null | (() => void) = null
  onmessage: null | ((e: { data: string }) => void) = null
  onclose: null | (() => void) = null
  onerror: null | (() => void) = null
  sent: string[] = []
  constructor(public url: string) {
    MockWS.last = this
    MockWS.instances++
  }
  send(d: string) {
    this.sent.push(d)
  }
  close() {
    this.readyState = 3
    this.onclose?.()
  }
  _open() {
    this.readyState = 1
    this.onopen?.()
  }
  _event(ev: unknown) {
    this.onmessage?.({ data: JSON.stringify({ type: "event", event: ev }) })
  }
}

// ─── 1. Pure reductions ───────────────────────────────────────────────────────

function testPureMath() {
  console.log("\n# 1. RMS + normalize (pure)")
  check("silence → 0", rmsFromByteFrequency(new Uint8Array([0, 0, 0, 0])) === 0)
  check("empty → 0", rmsFromByteFrequency(new Uint8Array([])) === 0)
  // constant 255 across all bins → RMS 255 → /255 = 1.0
  check("full-scale → 1.0", Math.abs(rmsFromByteFrequency(new Uint8Array([255, 255, 255])) - 1) < 1e-9)
  const quiet = rmsFromByteFrequency(new Uint8Array([30, 30, 30, 30]))
  const loud = rmsFromByteFrequency(new Uint8Array([200, 200, 200, 200]))
  check("louder input → larger RMS", loud > quiet, `${quiet.toFixed(3)} < ${loud.toFixed(3)}`)
  // RMS is NOT the mean — a single spike differs from the average
  const rms = rmsFromByteFrequency(new Uint8Array([0, 0, 0, 200]))
  check("RMS(one spike) between mean and peak", rms > 50 / 255 && rms < 200 / 255, rms.toFixed(3))
  check("normalize clamps at 1", normalizeVolume(5) === 1)
  check("normalize(0) = 0", normalizeVolume(0) === 0)
  check("normalize monotonic", normalizeVolume(0.3) < normalizeVolume(0.6))
}

// ─── 2a. AudioLevelMonitor ─────────────────────────────────────────────────────

function testMonitor() {
  console.log("\n# 2a. AudioLevelMonitor (mock AudioContext + manual clock)")
  const level = { value: 0 }
  const scheduler = new MockScheduler()
  const mon = new AudioLevelMonitor({ createAudioContext: makeMockAudioContext(level), scheduler })
  const out: number[] = []
  mon.attachStream(makeMockStream())
  mon.start((v) => out.push(v))

  level.value = 0
  scheduler.tick(3)
  check("quiet mic → ~0 volume", out.length > 0 && out[out.length - 1] < 0.05, `${out.at(-1)}`)

  level.value = 220
  scheduler.tick(6)
  check("loud mic → high volume", out[out.length - 1] > 0.6, `${out.at(-1)?.toFixed(3)}`)

  mon.stop()
  const nAfterStop = out.length
  scheduler.tick(3)
  check("stop() halts the loop", out.length === nAfterStop)
}

// ─── 2b. Adapter state machine ─────────────────────────────────────────────────

async function testStateMachine() {
  console.log("\n# 2b. Adapter state machine (mocked WS + audio)")
  const level = { value: 0 }
  const scheduler = new MockScheduler()
  let lastAudio: MockAudio | null = null
  MockWS.instances = 0

  const adapter = createNightjarOrbAdapter({
    WebSocketImpl: MockWS as unknown as typeof WebSocket,
    createAudioContext: makeMockAudioContext(level),
    getUserMedia: async () => makeMockStream(),
    createAudioElement: () => (lastAudio = new MockAudio()) as unknown as HTMLAudioElement,
    loadTtsAudio: async (p) => `mock://${p}`,
    scheduler,
    listeningTimeoutMs: 60,
    thinkingTimeoutMs: 60,
    reconnectMs: 30,
    publishPlayback: true,
  })

  const states: string[] = []
  const vols: number[] = []
  adapter.subscribe({
    onStateChange: (s) => states.push(s),
    onVolumeChange: (v) => vols.push(v),
  })

  check("subscribe emits current state", states[0] === "idle")
  check("subscribe opens the side-channel", MockWS.last !== null && MockWS.instances === 1)
  MockWS.last!._open()

  // wake → listening
  MockWS.last!._event({ kind: "wake", detected: true, max_score: 0.9 })
  await flush()
  level.value = 230
  scheduler.tick(5)
  check("wake → listening", adapter.getState() === "listening")
  check("listening drives mic volume", vols.some((v) => v > 0.5), `max=${Math.max(...vols).toFixed(3)}`)

  // transcription (final) → connecting (thinking), mic released
  vols.length = 0
  MockWS.last!._event({ kind: "transcription", text: "what time is it", final: true })
  await flush()
  check("final transcription → connecting", adapter.getState() === "connecting")
  check("mic released on connecting (volume → 0)", vols.includes(0))

  // our own echoes must NOT trigger playback
  MockWS.last!._event({ kind: "tts", state: "playing", source: "orb-ui" })
  MockWS.last!._event({ kind: "tts", state: "ready", path: "/echo.wav", source: "orb-ui" })
  await flush()
  check("ignores self-published tts echoes", adapter.getState() === "connecting")

  // tts ready → speaking
  MockWS.last!._event({ kind: "tts", state: "ready", path: "/home/x/.nightjar/tts_out.wav" })
  await flush(0)
  await flush(0)
  check("tts ready → speaking", adapter.getState() === "speaking")
  check("adapter published tts 'playing' back", MockWS.last!.sent.some((s) => s.includes('"playing"')))
  vols.length = 0
  level.value = 180
  scheduler.tick(5)
  check("speaking drives output volume", vols.some((v) => v > 0.4), `max=${Math.max(...vols).toFixed(3)}`)

  // playback ends → idle
  lastAudio!.fireEnded()
  await flush()
  check("playback ended → idle", adapter.getState() === "idle")
  check("adapter published tts 'ended' back", MockWS.last!.sent.some((s) => s.includes('"ended"')))

  // listening safety timeout → idle
  MockWS.last!._event({ kind: "wake", detected: true })
  await flush()
  check("second wake → listening", adapter.getState() === "listening")
  await flush(90)
  check("listening times out → idle", adapter.getState() === "idle")

  // WS drop after being open → error, then auto-reconnect → idle
  const before = MockWS.instances
  MockWS.last!.close()
  await flush()
  check("side-channel drop → error", adapter.getState() === "error")
  await waitFor(() => MockWS.instances > before, 1500)
  check("auto-reconnects", MockWS.instances > before)
  MockWS.last!._open()
  await flush()
  check("reopen clears error → idle", adapter.getState() === "idle")

  adapter.disconnect()
}

// ─── 3. Live integration against the REAL :8765 hub ────────────────────────────

function publishToHub(event: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(HUB)
    const timer = setTimeout(() => reject(new Error("publish timeout")), 3000)
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "publish", event }))
      setTimeout(() => {
        clearTimeout(timer)
        ws.close()
        resolve()
      }, 100)
    }
    ws.onerror = (e) => {
      clearTimeout(timer)
      reject(e)
    }
  })
}

async function testLiveHub(): Promise<void> {
  console.log(`\n# 3. Live integration vs real side-channel (${HUB})`)
  // reachability
  try {
    await publishToHub({ kind: "noop", source: "orb-ui-test" })
  } catch {
    check("side-channel reachable on :8765", false, "hub not running — start phase2-mcp/sidechannel.py")
    return
  }
  check("side-channel reachable on :8765", true)

  const level = { value: 0 }
  const scheduler = new MockScheduler()
  let lastAudio: MockAudio | null = null
  const adapter = createNightjarOrbAdapter({
    url: HUB, // REAL WebSocket (global) → REAL hub
    createAudioContext: makeMockAudioContext(level),
    getUserMedia: async () => makeMockStream(),
    createAudioElement: () => (lastAudio = new MockAudio()) as unknown as HTMLAudioElement,
    loadTtsAudio: async (p) => `mock://${p}`,
    scheduler,
    publishPlayback: false, // don't pollute the live hub with echoes
  })

  const states: string[] = []
  adapter.subscribe({ onStateChange: (s) => states.push(s), onVolumeChange: () => {} })

  // give the real socket a moment to connect
  await flush(400)

  await publishToHub({ kind: "wake", detected: true, max_score: 0.92 })
  check("real wake frame → listening", await waitFor(() => adapter.getState() === "listening"),
    `state=${adapter.getState()}`)

  await publishToHub({ kind: "transcription", text: "hey nightjar what's the weather", final: true })
  check("real transcription frame → connecting", await waitFor(() => adapter.getState() === "connecting"),
    `state=${adapter.getState()}`)

  await publishToHub({ kind: "tts", state: "ready", path: "/home/x/.nightjar/tts_out.wav" })
  check("real tts frame → speaking", await waitFor(() => adapter.getState() === "speaking"),
    `state=${adapter.getState()}`)

  if (lastAudio) {
    ;(lastAudio as MockAudio).fireEnded()
    check("playback end → idle", await waitFor(() => adapter.getState() === "idle"),
      `state=${adapter.getState()}`)
  }

  check("observed full lifecycle idle→listening→connecting→speaking→idle",
    ["idle", "listening", "connecting", "speaking", "idle"].every((s) => states.includes(s)),
    states.join("→"))

  adapter.disconnect()
}

async function main() {
  testPureMath()
  testMonitor()
  await testStateMachine()
  await testLiveHub()
  console.log(`\n${pass}/${pass + fail} checks passed`)
  process.exit(fail === 0 ? 0 : 1)
}

main()
