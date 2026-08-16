import type { RendererShutdownOutcome } from "./rendererVoiceShutdown"

export interface VoiceShutdownTarget {
  isDestroyed(): boolean
  destroy(): void
}

export interface VoiceShutdownLifecycleOptions<T extends VoiceShutdownTarget> {
  target: T | null
  requestRendererShutdown(target: T | null): Promise<RendererShutdownOutcome>
  destroyTarget(target: T): void
  stopOwnedWake(): Promise<void>
}

// Both Voice Off and explicit Quit must close renderer-owned media before touching
// the wake service. The caller chooses the exact-window fallback policy, but this
// ordering is shared and independently testable without Electron or real media.
export async function shutdownRendererThenOwnedWake<T extends VoiceShutdownTarget>({
  target,
  requestRendererShutdown,
  destroyTarget,
  stopOwnedWake,
}: VoiceShutdownLifecycleOptions<T>): Promise<RendererShutdownOutcome> {
  const outcome = await requestRendererShutdown(target)
  if (outcome !== "acknowledged" && target && !target.isDestroyed()) destroyTarget(target)
  await stopOwnedWake()
  return outcome
}
