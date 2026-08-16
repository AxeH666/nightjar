import { randomUUID } from "node:crypto"
import type { VoiceShutdownRequest } from "../shared/nightjarBridge"

export interface VoiceShutdownWebContents {
  id: number
  isDestroyed(): boolean
  send(channel: string, request: VoiceShutdownRequest): void
}

export interface VoiceShutdownWindow {
  isDestroyed(): boolean
  destroy(): void
  webContents: VoiceShutdownWebContents
}

export type RendererShutdownOutcome = "acknowledged" | "destroyed"

interface PendingShutdown {
  requestId: string
  senderId: number
  finish: (outcome: RendererShutdownOutcome) => void
}

// Main owns exactly one in-flight renderer teardown. The acknowledgement is bound to
// both the generated request id and the target WebContents so stale/other-window IPC
// cannot advance quit ordering.
export class RendererVoiceShutdownCoordinator {
  private pending: PendingShutdown | null = null

  async request(window: VoiceShutdownWindow | null, timeoutMs: number): Promise<RendererShutdownOutcome> {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return "destroyed"
    const target = window
    const request: VoiceShutdownRequest = { id: randomUUID() }
    return new Promise<RendererShutdownOutcome>((resolve) => {
      let settled = false
      const finish = (outcome: RendererShutdownOutcome) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (this.pending?.requestId === request.id) this.pending = null
        resolve(outcome)
      }
      const timeout = setTimeout(() => {
        if (!target.isDestroyed()) target.destroy()
        finish("destroyed")
      }, timeoutMs)
      this.pending = { requestId: request.id, senderId: target.webContents.id, finish }
      try {
        target.webContents.send("nightjar:voiceShutdown", request)
      } catch {
        if (!target.isDestroyed()) target.destroy()
        finish("destroyed")
      }
    })
  }

  acknowledge(senderId: number, requestId: unknown): boolean {
    const pending = this.pending
    if (!pending || typeof requestId !== "string" || pending.senderId !== senderId || pending.requestId !== requestId) return false
    pending.finish("acknowledged")
    return true
  }
}
