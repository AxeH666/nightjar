import { describe, expect, test } from "vitest"
import { RendererVoiceShutdownCoordinator, type VoiceShutdownWindow } from "./rendererVoiceShutdown"

function fakeWindow(id = 1, send?: (requestId: string) => void): VoiceShutdownWindow & { destroyed: boolean } {
  const target = {
    destroyed: false,
    isDestroyed: () => target.destroyed,
    destroy: () => { target.destroyed = true },
    webContents: {
      id,
      isDestroyed: () => target.destroyed,
      send: (_channel: string, request: { id: string }) => send?.(request.id),
    },
  }
  return target
}

describe("renderer Voice shutdown coordinator", () => {
  test("acknowledgement from the exact target continues shutdown once", async () => {
    const coordinator = new RendererVoiceShutdownCoordinator()
    let requestId = ""
    const target = fakeWindow(7, (id) => { requestId = id })
    const pending = coordinator.request(target, 100)
    expect(coordinator.acknowledge(8, requestId)).toBe(false)
    expect(coordinator.acknowledge(7, "stale")).toBe(false)
    expect(coordinator.acknowledge(7, requestId)).toBe(true)
    expect(await pending).toBe("acknowledged")
    expect(coordinator.acknowledge(7, requestId)).toBe(false)
    expect(target.destroyed).toBe(false)
  })

  test("a missing acknowledgement times out without deciding the caller's window fallback", async () => {
    const coordinator = new RendererVoiceShutdownCoordinator()
    const target = fakeWindow(1)
    const unrelated = fakeWindow(2)
    expect(await coordinator.request(target, 1)).toBe("timed-out")
    expect(target.destroyed).toBe(false)
    expect(unrelated.destroyed).toBe(false)
  })

  test("a renderer send failure reports unavailable without destroying the target", async () => {
    const coordinator = new RendererVoiceShutdownCoordinator()
    const target = fakeWindow(1, () => { throw new Error("renderer gone") })
    expect(await coordinator.request(target, 100)).toBe("unavailable")
    expect(target.destroyed).toBe(false)
  })

  test("overlapping requests share one bounded request and cannot leave an orphaned timeout", async () => {
    const coordinator = new RendererVoiceShutdownCoordinator()
    let requestId = ""
    const firstTarget = fakeWindow(1, (id) => { requestId = id })
    const secondTarget = fakeWindow(2)
    const first = coordinator.request(firstTarget, 20)
    const second = coordinator.request(secondTarget, 20)
    expect(second).toBe(first)
    expect(coordinator.acknowledge(1, requestId)).toBe(true)
    expect(await second).toBe("acknowledged")
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(firstTarget.destroyed).toBe(false)
    expect(secondTarget.destroyed).toBe(false)
  })

  test("a stale acknowledgement cannot complete the request for a replacement target", async () => {
    const coordinator = new RendererVoiceShutdownCoordinator()
    let firstId = ""
    const first = fakeWindow(1, (id) => { firstId = id })
    const firstPending = coordinator.request(first, 100)
    expect(coordinator.acknowledge(1, firstId)).toBe(true)
    await firstPending

    let secondId = ""
    const replacement = fakeWindow(2, (id) => { secondId = id })
    const secondPending = coordinator.request(replacement, 100)
    expect(coordinator.acknowledge(1, firstId)).toBe(false)
    expect(coordinator.acknowledge(2, firstId)).toBe(false)
    expect(coordinator.acknowledge(2, secondId)).toBe(true)
    expect(await secondPending).toBe("acknowledged")
  })
})
