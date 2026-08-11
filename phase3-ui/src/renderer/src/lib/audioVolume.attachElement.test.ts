import { afterEach, describe, expect, it, vi } from "vitest"
import {
  AudioLevelMonitor,
  type AnalyserLike,
  type AudioCtxLike,
  type SourceLike,
} from "./audioVolume"

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

interface ContextHarness {
  context: AudioCtxLike
  events: string[]
  createdElements: unknown[]
  resumeGates: Deferred<void>[]
}

function makeContext(): ContextHarness {
  const events: string[] = []
  const createdElements: unknown[] = []
  const resumeGates: Deferred<void>[] = []
  const destination = { kind: "destination" }
  let state = "suspended"

  const analyser: AnalyserLike = {
    fftSize: 0,
    frequencyBinCount: 4,
    getByteFrequencyData: () => {},
  }

  const context: AudioCtxLike = {
    get state() {
      return state
    },
    destination,
    resume: vi.fn(() => {
      events.push("resume")
      const gate = deferred<void>()
      resumeGates.push(gate)
      return gate.promise.then(() => {
        state = "running"
        events.push("resumed")
      })
    }),
    createAnalyser: vi.fn(() => {
      events.push("create-analyser")
      return analyser
    }),
    createMediaStreamSource: vi.fn(() => {
      throw new Error("not used")
    }),
    createMediaElementSource: vi.fn((element: unknown) => {
      events.push("create-source")
      createdElements.push(element)
      const source: SourceLike = {
        connect: vi.fn((target: unknown) => {
          events.push(target === destination ? "connect-destination" : "connect-analyser")
        }),
        disconnect: vi.fn(),
      }
      return source
    }),
    close: vi.fn(async () => {}),
  }

  return {
    context,
    events,
    createdElements,
    resumeGates,
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
})

describe("AudioLevelMonitor TTS attachment (NJ-91)", () => {
  it("waits for a suspended context before moving the element into the graph", async () => {
    const harness = makeContext()
    const monitor = new AudioLevelMonitor({ createAudioContext: () => harness.context })
    const element = { clip: "one" }

    const attached = monitor.attachElement(element)
    await flushMicrotasks()

    expect(harness.events).toEqual(["resume"])
    expect(harness.createdElements).toEqual([])

    harness.resumeGates[0].resolve()
    await expect(attached).resolves.toBe(true)
    expect(harness.createdElements).toEqual([element])
    expect(harness.events).toEqual([
      "resume",
      "resumed",
      "create-analyser",
      "create-source",
      "connect-analyser",
      "connect-destination",
    ])
  })

  it("fails open without a graph when resume rejects", async () => {
    const harness = makeContext()
    const monitor = new AudioLevelMonitor({ createAudioContext: () => harness.context })

    const attached = monitor.attachElement({ clip: "rejected" })
    await flushMicrotasks()
    harness.resumeGates[0].reject(new Error("audio device unavailable"))

    await expect(attached).resolves.toBe(false)
    expect(harness.createdElements).toEqual([])
    expect(harness.events).toEqual(["resume"])
  })

  it("never attaches after a timeout, even if resume resolves later", async () => {
    vi.useFakeTimers()
    const harness = makeContext()
    const monitor = new AudioLevelMonitor({
      createAudioContext: () => harness.context,
      resumeTimeoutMs: 25,
    })

    const attached = monitor.attachElement({ clip: "late" })
    await flushMicrotasks()
    await vi.advanceTimersByTimeAsync(25)

    await expect(attached).resolves.toBe(false)
    harness.resumeGates[0].resolve()
    await flushMicrotasks()
    expect(harness.createdElements).toEqual([])
  })

  it("invalidates a pending attachment when stopped", async () => {
    const harness = makeContext()
    const monitor = new AudioLevelMonitor({ createAudioContext: () => harness.context })

    const attached = monitor.attachElement({ clip: "stopped" })
    await flushMicrotasks()
    monitor.stop()
    harness.resumeGates[0].resolve()

    await expect(attached).resolves.toBe(false)
    expect(harness.createdElements).toEqual([])
  })

  it("allows only the newest pending element to attach", async () => {
    const harness = makeContext()
    const monitor = new AudioLevelMonitor({ createAudioContext: () => harness.context })
    const first = { clip: "first" }
    const second = { clip: "second" }

    const firstResult = monitor.attachElement(first)
    await flushMicrotasks()
    const secondResult = monitor.attachElement(second)
    await flushMicrotasks()

    harness.resumeGates[1].resolve()
    await expect(secondResult).resolves.toBe(true)
    harness.resumeGates[0].resolve()
    await expect(firstResult).resolves.toBe(false)

    expect(harness.createdElements).toEqual([second])
  })
})
