import { describe, expect, test } from "vitest"
import { shutdownRendererThenOwnedWake, type VoiceShutdownTarget } from "./voiceShutdownLifecycle"

function target(name: string, events: string[]): VoiceShutdownTarget & { destroyed: boolean } {
  const window = {
    destroyed: false,
    isDestroyed: () => window.destroyed,
    destroy: () => {
      window.destroyed = true
      events.push(`destroy:${name}`)
    },
  }
  return window
}

describe("Voice Off and Quit lifecycle ordering", () => {
  test("acknowledged renderer teardown completes before owned wake shutdown", async () => {
    const events: string[] = []
    const window = target("voice", events)
    await shutdownRendererThenOwnedWake({
      target: window,
      requestRendererShutdown: async () => {
        events.push("renderer:ack")
        return "acknowledged"
      },
      destroyTarget: (value) => value.destroy(),
      stopOwnedWake: async () => { events.push("wake:stop") },
    })
    expect(events).toEqual(["renderer:ack", "wake:stop"])
    expect(window.destroyed).toBe(false)
  })

  test("Voice Off timeout destroys only its exact stale window before wake shutdown", async () => {
    const events: string[] = []
    const stale = target("stale", events)
    const replacement = target("replacement", events)
    await shutdownRendererThenOwnedWake({
      target: stale,
      requestRendererShutdown: async () => {
        events.push("renderer:timeout")
        return "timed-out"
      },
      destroyTarget: (value) => value.destroy(),
      stopOwnedWake: async () => { events.push("wake:stop") },
    })
    expect(events).toEqual(["renderer:timeout", "destroy:stale", "wake:stop"])
    expect(replacement.destroyed).toBe(false)
  })

  test("Quit unavailable fallback keeps unrelated windows alive and still stops owned wake", async () => {
    const events: string[] = []
    const quitTarget = target("quit", events)
    const unrelated = target("unrelated", events)
    await shutdownRendererThenOwnedWake({
      target: quitTarget,
      requestRendererShutdown: async () => "unavailable",
      destroyTarget: (value) => value.destroy(),
      stopOwnedWake: async () => { events.push("wake:stop") },
    })
    expect(events).toEqual(["destroy:quit", "wake:stop"])
    expect(unrelated.destroyed).toBe(false)
  })
})
