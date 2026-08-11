import { afterEach, describe, expect, it, vi } from "vitest"
import { createNightjarOrbAdapter } from "./orbAdapter"
import type { AnalyserLike, AudioCtxLike, FrameScheduler, SourceLike } from "./audioVolume"

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

async function flushMicrotasks(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve()
}

class TestAudio {
  src = ""
  paused = true
  onplaying: null | (() => void) = null
  onended: null | (() => void) = null
  onerror: null | (() => void) = null

  constructor(
    readonly name: string,
    private readonly events: string[],
    private readonly rejectPlay = false,
  ) {}

  async play(): Promise<void> {
    this.events.push(`play:${this.name}`)
    if (this.rejectPlay) throw new Error("playback refused")
    this.paused = false
    queueMicrotask(() => this.onplaying?.())
  }

  pause(): void {
    this.events.push(`pause:${this.name}`)
    this.paused = true
  }
}

class TestSocket {
  readyState = 0
  onopen: null | (() => void) = null
  onmessage: null | ((event: { data: string }) => void) = null
  onclose: null | (() => void) = null
  onerror: null | (() => void) = null

  send(): void {}

  close(): void {
    this.readyState = 3
    this.onclose?.()
  }

  open(): void {
    this.readyState = 1
    this.onopen?.()
  }

  publish(event: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ type: "event", event }) })
  }
}

interface AdapterHarnessOptions {
  initialContextState?: string
  resume?: () => Promise<void>
  throwOnConnect?: boolean
  rejectPlay?: boolean
}

function makeHarness(options: AdapterHarnessOptions = {}) {
  const events: string[] = []
  const audios: TestAudio[] = []
  const errors: unknown[] = []
  const destination = { kind: "destination" }
  let contextState = options.initialContextState ?? "suspended"
  let socket: TestSocket | null = null

  const analyser: AnalyserLike = {
    fftSize: 0,
    frequencyBinCount: 4,
    getByteFrequencyData: () => {},
  }
  const scheduler: FrameScheduler = {
    schedule: vi.fn(() => {
      events.push("meter-start")
      return 1
    }),
    cancel: vi.fn(),
  }
  const context: AudioCtxLike = {
    get state() {
      return contextState
    },
    destination,
    resume: vi.fn(async () => {
      events.push("resume")
      await (options.resume?.() ?? Promise.resolve())
      contextState = "running"
      events.push("resumed")
    }),
    createAnalyser: vi.fn(() => {
      events.push("create-analyser")
      return analyser
    }),
    createMediaStreamSource: vi.fn(() => {
      throw new Error("not used")
    }),
    createMediaElementSource: vi.fn((element: unknown) => {
      const audio = element as TestAudio
      events.push(`create-source:${audio.name}`)
      const source: SourceLike = {
        connect: vi.fn((target: unknown) => {
          events.push(target === destination ? "connect-destination" : "connect-analyser")
          if (options.throwOnConnect && target === destination) {
            throw new Error("graph connection failed")
          }
        }),
        disconnect: vi.fn(() => events.push(`disconnect:${audio.name}`)),
      }
      return source
    }),
    close: vi.fn(async () => {}),
  }

  class Socket extends TestSocket {
    constructor(_url: string) {
      super()
      socket = this
    }
  }

  const adapter = createNightjarOrbAdapter({
    WebSocketImpl: Socket as unknown as typeof WebSocket,
    createAudioContext: () => context,
    createAudioElement: () => {
      const audio = new TestAudio(`clip-${audios.length + 1}`, events, options.rejectPlay)
      audios.push(audio)
      return audio as unknown as HTMLAudioElement
    },
    loadTtsAudio: async (path) => `mock://${path}`,
    getUserMedia: async () => ({ getTracks: () => [] }),
    scheduler,
    publishPlayback: false,
    reconnectMs: 60_000,
    listeningTimeoutMs: 60_000,
    thinkingTimeoutMs: 60_000,
    speakingTimeoutMs: 60_000,
    onTtsError: (error) => errors.push(error),
  })
  adapter.subscribe({ onStateChange: () => {}, onVolumeChange: () => {} })
  if (!socket) throw new Error("adapter did not create its WebSocket")
  const testSocket = socket as TestSocket
  testSocket.open()

  return { adapter, audios, context, errors, events, scheduler, socket: testSocket }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("orbAdapter pre-play TTS attachment (NJ-91)", () => {
  it("attaches the graph before play and starts metering only from onplaying", async () => {
    const gate = deferred<void>()
    const harness = makeHarness({ resume: () => gate.promise })

    harness.socket.publish({ kind: "tts", state: "ready", path: "one.wav" })
    await flushMicrotasks()
    expect(harness.events).toEqual(["resume"])

    gate.resolve()
    await flushMicrotasks()

    expect(harness.events).toEqual([
      "resume",
      "resumed",
      "create-analyser",
      "create-source:clip-1",
      "connect-analyser",
      "connect-destination",
      "play:clip-1",
      "meter-start",
    ])
    expect(harness.adapter.getState()).toBe("speaking")
    expect(harness.errors).toEqual([])
    harness.adapter.disconnect()
  })

  it("keeps direct playback when resume rejects", async () => {
    const harness = makeHarness({ resume: async () => Promise.reject(new Error("no device")) })

    harness.socket.publish({ kind: "tts", state: "ready", path: "fallback.wav" })
    await flushMicrotasks(20)

    expect(harness.events).toContain("play:clip-1")
    expect(harness.events.some((event) => event.startsWith("create-source:"))).toBe(false)
    expect(harness.events).not.toContain("meter-start")
    expect(harness.adapter.getState()).toBe("speaking")
    expect(harness.errors).toEqual([])
    harness.adapter.disconnect()
  })

  it("keeps direct playback and never attaches after a timed-out resume", async () => {
    vi.useFakeTimers()
    const gate = deferred<void>()
    const harness = makeHarness({ resume: () => gate.promise })

    harness.socket.publish({ kind: "tts", state: "ready", path: "timeout.wav" })
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(1000)
    await flushMicrotasks()

    expect(harness.events).toContain("play:clip-1")
    expect(harness.events.filter((event) => event === "play:clip-1")).toHaveLength(1)
    expect(harness.events.some((event) => event.startsWith("create-source:"))).toBe(false)
    expect(harness.events).not.toContain("meter-start")
    expect(harness.adapter.getState()).toBe("speaking")
    expect(harness.errors).toEqual([])

    gate.resolve()
    await flushMicrotasks()
    expect(harness.events.some((event) => event.startsWith("create-source:"))).toBe(false)
    harness.adapter.disconnect()
  })

  it("cannot attach or play after stop wins a pending resume", async () => {
    const gate = deferred<void>()
    const harness = makeHarness({ resume: () => gate.promise })

    harness.socket.publish({ kind: "tts", state: "ready", path: "stopped.wav" })
    await flushMicrotasks()
    harness.adapter.stop!()
    gate.resolve()
    await flushMicrotasks()

    expect(harness.events.some((event) => event.startsWith("create-source:"))).toBe(false)
    expect(harness.events.some((event) => event.startsWith("play:"))).toBe(false)
    expect(harness.errors).toEqual([])
    expect(harness.adapter.getState()).toBe("idle")
    harness.adapter.disconnect()
  })

  it.each(["newest-first", "oldest-first"] as const)(
    "preserves playback-ID protection when resumes settle %s",
    async (resolutionOrder) => {
      const gates: Deferred<void>[] = []
      const harness = makeHarness({
        resume: () => {
          const gate = deferred<void>()
          gates.push(gate)
          return gate.promise
        },
      })

      harness.socket.publish({ kind: "tts", state: "ready", path: "first.wav" })
      await flushMicrotasks()
      harness.socket.publish({ kind: "tts", state: "ready", path: "second.wav" })
      await flushMicrotasks()
      expect(gates).toHaveLength(2)

      if (resolutionOrder === "newest-first") {
        gates[1].resolve()
        await flushMicrotasks()
        gates[0].resolve()
        await flushMicrotasks()
      } else {
        gates[0].resolve()
        await flushMicrotasks()
        expect(harness.events).not.toContain("create-source:clip-1")
        expect(harness.events).not.toContain("play:clip-1")
        gates[1].resolve()
        await flushMicrotasks()
      }

      expect(harness.events).toContain("create-source:clip-2")
      expect(harness.events).toContain("play:clip-2")
      expect(harness.events).not.toContain("create-source:clip-1")
      expect(harness.events).not.toContain("play:clip-1")
      expect(harness.adapter.getState()).toBe("speaking")
      expect(harness.errors).toEqual([])
      harness.adapter.disconnect()
    },
  )

  it("cleans up a partially-created graph when connection fails", async () => {
    const harness = makeHarness({ initialContextState: "running", throwOnConnect: true })

    harness.socket.publish({ kind: "tts", state: "ready", path: "broken.wav" })
    await flushMicrotasks()

    expect(harness.events).toContain("create-source:clip-1")
    expect(harness.events).not.toContain("play:clip-1")
    expect(harness.events).toContain("disconnect:clip-1")
    expect(harness.events).toContain("pause:clip-1")
    expect(harness.errors).toHaveLength(1)
    expect(String(harness.errors[0])).toContain("graph connection failed")
    expect(harness.adapter.getState()).toBe("idle")
    harness.adapter.disconnect()
  })

  it("disconnects a pre-attached graph when play rejects", async () => {
    const harness = makeHarness({ initialContextState: "running", rejectPlay: true })

    harness.socket.publish({ kind: "tts", state: "ready", path: "refused.wav" })
    await flushMicrotasks()

    expect(harness.events).toContain("create-source:clip-1")
    expect(harness.events).toContain("play:clip-1")
    expect(harness.events).toContain("disconnect:clip-1")
    expect(harness.events).toContain("pause:clip-1")
    expect(harness.errors).toHaveLength(1)
    expect(String(harness.errors[0])).toContain("playback refused")
    expect(harness.adapter.getState()).toBe("idle")
    harness.adapter.disconnect()
  })
})
