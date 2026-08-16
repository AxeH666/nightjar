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

  test("a missing acknowledgement destroys only the requested window after the bound", async () => {
    const coordinator = new RendererVoiceShutdownCoordinator()
    const target = fakeWindow(1)
    const unrelated = fakeWindow(2)
    expect(await coordinator.request(target, 1)).toBe("destroyed")
    expect(target.destroyed).toBe(true)
    expect(unrelated.destroyed).toBe(false)
  })

  test("a renderer send failure fails closed by destroying the target", async () => {
    const coordinator = new RendererVoiceShutdownCoordinator()
    const target = fakeWindow(1, () => { throw new Error("renderer gone") })
    expect(await coordinator.request(target, 100)).toBe("destroyed")
    expect(target.destroyed).toBe(true)
  })
})
