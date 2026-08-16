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

export type RendererShutdownOutcome = "acknowledged" | "timed-out" | "unavailable"

interface PendingShutdown {
  requestId: string
  senderId: number
  finish: (outcome: RendererShutdownOutcome) => void
  result: Promise<RendererShutdownOutcome>
}

// Main owns exactly one in-flight renderer teardown. The acknowledgement is bound to
// both the generated request id and the target WebContents so stale/other-window IPC
// cannot advance quit ordering.
export class RendererVoiceShutdownCoordinator {
  private pending: PendingShutdown | null = null

  request(window: VoiceShutdownWindow | null, timeoutMs: number): Promise<RendererShutdownOutcome> {
    // Off and Quit can overlap. They share one request/timeout rather than replacing
    // a pending request and leaving its timeout able to act later.
    if (this.pending) return this.pending.result
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve("unavailable")
    const target = window
    const request: VoiceShutdownRequest = { id: randomUUID() }
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    let resolveResult: (outcome: RendererShutdownOutcome) => void = () => {}
    const result = new Promise<RendererShutdownOutcome>((resolve) => { resolveResult = resolve })
    const finish = (outcome: RendererShutdownOutcome) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      if (this.pending?.requestId === request.id) this.pending = null
      resolveResult(outcome)
    }
    this.pending = { requestId: request.id, senderId: target.webContents.id, finish, result }
    timeout = setTimeout(() => finish("timed-out"), timeoutMs)
    try {
      target.webContents.send("nightjar:voiceShutdown", request)
    } catch {
      finish("unavailable")
    }
    return result
  }

  acknowledge(senderId: number, requestId: unknown): boolean {
    const pending = this.pending
    if (!pending || typeof requestId !== "string" || pending.senderId !== senderId || pending.requestId !== requestId) return false
    pending.finish("acknowledged")
    return true
  }
}
