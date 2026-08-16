import { afterEach, describe, expect, test, vi } from "vitest"
import { EventEmitter } from "node:events"

const spawnState = vi.hoisted(() => ({ impl: null as ((...args: unknown[]) => unknown) | null }))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>()
  return {
    ...actual,
    spawn: (...args: unknown[]) => {
      if (!spawnState.impl) throw new Error("unexpected test spawn")
      return spawnState.impl(...args)
    },
  }
})

import { Supervisor, type ServiceDef } from "./supervisor"

class FakeChild extends EventEmitter {
  readonly pid: number
  readonly kill = vi.fn((_signal?: NodeJS.Signals) => true)
  constructor(pid: number) {
    super()
    this.pid = pid
  }
}

function ownedWake(listenerInitially = false, exitOnKill = true) {
  let listener = listenerInitially
  let child: FakeChild | undefined
  const spawnCalls: unknown[][] = []
  spawnState.impl = (...args: unknown[]) => {
    spawnCalls.push(args)
    listener = true
    child = new FakeChild(4242)
    child.kill.mockImplementation(() => {
      if (exitOnKill) {
        listener = false
        queueMicrotask(() => child?.emit("exit", 0, null))
      }
      return true
    })
    queueMicrotask(() => child?.emit("spawn"))
    return child
  }
  const def: ServiceDef = {
    name: "wake-daemon",
    command: "fake-wake",
    args: [],
    ready: async () => listener,
    enabled: () => true,
    blockUnmanagedListener: true,
    readyTimeoutMs: 5,
    autoRestart: false,
  }
  return {
    def,
    child: () => child,
    spawnCalls,
    listener: () => listener,
  }
}

afterEach(() => {
  spawnState.impl = null
})

// These lifecycle tests use only fake ChildProcess and listener objects. They never
// inspect, adopt, or terminate an OS process.
describe("Supervisor owned-only wake lifecycle", () => {
  test("starts and retains one owned wake child when no listener exists", async () => {
    const h = ownedWake()
    const sup = new Supervisor([h.def], undefined, { voiceStopTimeoutMs: 5 })
    await sup.start()

    expect(h.spawnCalls).toHaveLength(1)
    expect(h.child()).toBeDefined()
    expect(sup.status()[0]).toMatchObject({ state: "healthy", pid: 4242 })
  })

  test("an existing listener blocks Voice without adoption, a PID, or a termination call", async () => {
    const h = ownedWake(true)
    const sup = new Supervisor([h.def], undefined, { voiceStopTimeoutMs: 5 })
    await sup.start()
    await sup.stopVoiceService("wake-daemon")
    await sup.startService("wake-daemon")

    expect(h.spawnCalls).toHaveLength(0)
    expect(h.child()).toBeUndefined()
    expect(sup.status()[0]).toMatchObject({ state: "stopped", pid: undefined })
    expect(sup.status()[0].detail).toContain("STILL listening")
    expect(sup.status()[0].detail).toContain("manual cleanup required")
  })

  test("a disabled wake service remains blocked when an unmanaged listener exists", async () => {
    const h = ownedWake(true)
    h.def.enabled = () => false
    const sup = new Supervisor([h.def], undefined, { voiceStopTimeoutMs: 5 })
    await sup.start()

    expect(h.spawnCalls).toHaveLength(0)
    expect(sup.status()[0]).toMatchObject({ state: "stopped" })
    expect(sup.status()[0].detail).toContain("STILL listening")
  })

  test("generic non-Voice services still adopt a healthy listener", async () => {
    const sup = new Supervisor([{
      name: "ordinary-service", command: "unused", args: [], ready: async () => true,
    }])
    await sup.start()
    expect(sup.status()[0].state).toBe("adopted")
  })

  test("Voice Off stops the retained child, observes exit, and confirms listener disappearance", async () => {
    const h = ownedWake()
    const sup = new Supervisor([h.def], undefined, { voiceStopTimeoutMs: 5 })
    await sup.start()
    await sup.stopVoiceService("wake-daemon")

    expect(h.child()!.kill).toHaveBeenCalledWith("SIGTERM")
    expect(h.listener()).toBe(false)
    expect(sup.status()[0]).toMatchObject({ state: "stopped", detail: "disabled" })
  })

  test("repeated Voice Off is idempotent for an owned child", async () => {
    const h = ownedWake()
    const sup = new Supervisor([h.def], undefined, { voiceStopTimeoutMs: 5 })
    await sup.start()
    await sup.stopVoiceService("wake-daemon")
    await sup.stopVoiceService("wake-daemon")

    expect(h.child()!.kill).toHaveBeenCalledTimes(1)
  })

  test("explicit Quit uses the same owned-child shutdown", async () => {
    const h = ownedWake()
    const sup = new Supervisor([h.def], undefined, { voiceStopTimeoutMs: 5 })
    await sup.start()
    await sup.stop()

    expect(h.child()!.kill).toHaveBeenCalledTimes(1)
    expect(h.listener()).toBe(false)
    expect(sup.status()[0]).toMatchObject({ state: "stopped", detail: "disabled" })
  })

  test("a listener remaining after owned child exit is reported stuck rather than safely Off", async () => {
    const h = ownedWake()
    const sup = new Supervisor([h.def], undefined, { voiceStopTimeoutMs: 5 })
    await sup.start()
    h.child()!.kill.mockImplementation(() => {
      queueMicrotask(() => h.child()?.emit("exit", 0, null))
      return true
    })
    await sup.stopVoiceService("wake-daemon")

    expect(sup.status()[0]).toMatchObject({ state: "stopped" })
    expect(sup.status()[0].detail).toContain("STILL listening")
  })

  test("a child that does not exit reaches a bounded stuck result with no PID fallback", async () => {
    const h = ownedWake(false, false)
    const sup = new Supervisor([h.def], undefined, { voiceStopTimeoutMs: 1 })
    await sup.start()
    await sup.stopVoiceService("wake-daemon")
    await sup.stopVoiceService("wake-daemon")

    expect(h.child()!.kill).toHaveBeenCalledTimes(1)
    expect(sup.status()[0]).toMatchObject({ state: "stopped", pid: 4242 })
    expect(sup.status()[0].detail).toContain("owned wake child did not exit")
  })

  test("wake restart denies an existing unmanaged listener without a spawn or termination call", async () => {
    const h = ownedWake(true)
    const sup = new Supervisor([h.def], undefined, { voiceStopTimeoutMs: 5 })
    await sup.restartService("wake-daemon")

    expect(h.spawnCalls).toHaveLength(0)
    expect(h.child()).toBeUndefined()
    expect(sup.status()[0].detail).toContain("STILL listening")
  })
})
