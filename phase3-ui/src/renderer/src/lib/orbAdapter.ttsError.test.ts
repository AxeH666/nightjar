// NJ-37 regression: a TTS clip that cannot be loaded or played must surface a
// VISIBLE failure (onTtsError) — never silent silence. These tests re-trigger the
// exact failure paths headlessly (rule 6's code-level half; audible playback on a
// real device stays a rule-8 hardware item).
import { describe, expect, it } from "vitest"
import { createNightjarOrbAdapter, type NightjarOrbAdapterOptions } from "./orbAdapter"
import type { FrameScheduler } from "./audioVolume"

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

const mockScheduler: FrameScheduler = { schedule: () => 0, cancel: () => {} }

function makeMockAudioContext() {
  return () => ({
    state: "running",
    createAnalyser: () => ({
      fftSize: 256,
      frequencyBinCount: 128,
      getByteFrequencyData: (arr: Uint8Array) => arr.fill(0),
    }),
    createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
    createMediaElementSource: () => ({ connect: () => {}, disconnect: () => {} }),
    destination: {},
    resume: async () => {},
    close: async () => {},
  })
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
}

class MockWS {
  static last: MockWS | null = null
  readyState = 0
  onopen: null | (() => void) = null
  onmessage: null | ((e: { data: string }) => void) = null
  onclose: null | (() => void) = null
  onerror: null | (() => void) = null
  sent: string[] = []
  constructor(public url: string) {
    MockWS.last = this
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

function makeAdapter(overrides: Partial<NightjarOrbAdapterOptions>) {
  let lastAudio: MockAudio | null = null
  const errors: unknown[] = []
  const adapter = createNightjarOrbAdapter({
    WebSocketImpl: MockWS as unknown as typeof WebSocket,
    createAudioContext: makeMockAudioContext(),
    getUserMedia: async () => ({ getTracks: () => [{ stop: () => {}, readyState: "live" }] }),
    createAudioElement: () => (lastAudio = new MockAudio()) as unknown as HTMLAudioElement,
    scheduler: mockScheduler,
    reconnectMs: 10_000,
    onTtsError: (err) => errors.push(err),
    ...overrides,
  })
  adapter.subscribe({ onStateChange: () => {}, onVolumeChange: () => {} })
  MockWS.last!._open()
  return { adapter, errors, ws: MockWS.last!, getLastAudio: () => lastAudio }
}

describe("orbAdapter TTS failure visibility (NJ-37)", () => {
  it("the default resolver rejects loudly — there is no file:// fallback", async () => {
    const { adapter, errors } = makeAdapter({}) // no loadTtsAudio injected
    MockWS.last!._event({ kind: "tts", state: "ready", path: "/home/x/.nightjar/tts_out.wav" })
    await flush()
    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toContain("no loadTtsAudio resolver")
    expect(adapter.getState()).toBe("idle") // visibly failed, pipeline still usable
    adapter.disconnect()
  })

  it("a missing readAudio bridge (resolver throws) reaches onTtsError and returns to idle", async () => {
    const { adapter, errors } = makeAdapter({
      loadTtsAudio: async () => {
        throw new Error("nightjar.readAudio bridge unavailable")
      },
    })
    MockWS.last!._event({ kind: "tts", state: "ready", path: "/x.wav" })
    await flush()
    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toContain("readAudio bridge unavailable")
    expect(adapter.getState()).toBe("idle")
    adapter.disconnect()
  })

  it("an <audio> element error after a successful load reports onTtsError and publishes 'ended'", async () => {
    const { adapter, errors, ws, getLastAudio } = makeAdapter({
      loadTtsAudio: async () => "mock://tts",
    })
    ws._event({ kind: "tts", state: "ready", path: "/x.wav" })
    await flush()
    await flush() // onplaying fires on a microtask after play()
    expect(adapter.getState()).toBe("speaking")
    getLastAudio()!.onerror?.()
    await flush()
    expect(errors).toHaveLength(1)
    expect(adapter.getState()).toBe("idle")
    expect(ws.sent.some((s) => s.includes('"ended"'))).toBe(true)
    adapter.disconnect()
  })

  it("a superseded in-flight load is NOT a failure (B11) — only the winning clip reports", async () => {
    let rejectFirst: ((err: Error) => void) | null = null
    let call = 0
    const { adapter, errors, ws } = makeAdapter({
      loadTtsAudio: (path: string) => {
        call++
        if (call === 1) return new Promise<string>((_, rej) => (rejectFirst = rej))
        return Promise.resolve(`mock://${path}`)
      },
    })
    ws._event({ kind: "tts", state: "ready", path: "/first.wav" }) // load hangs
    ws._event({ kind: "tts", state: "ready", path: "/second.wav" }) // supersedes it
    await flush()
    await flush()
    expect(adapter.getState()).toBe("speaking") // second clip won
    rejectFirst!(new Error("stale load lost the race"))
    await flush()
    expect(errors).toHaveLength(0) // supersession is normal flow, not a user-visible failure
    expect(adapter.getState()).toBe("speaking")
    adapter.disconnect()
  })
})
