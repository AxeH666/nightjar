import type { VoiceStatus } from "../../../shared/nightjarBridge"

// Renderer-side client for the voice master switch (NJ-57). Thin typed accessor over
// the preload bridge; the main process owns the pref and the wake-daemon lifecycle
// (enable = spawn, disable = KILL — the OS mic indicator is the source of truth).

export type { VoiceStatus } from "../../../shared/nightjarBridge"

function bridge() {
  return window.nightjar?.voice ?? null
}

export const voice = {
  // Current state; disabled when the bridge is absent (renderer outside the app).
  async get(): Promise<VoiceStatus> {
    return (await bridge()?.get()) ?? { enabled: false, running: false, starting: false, stillListening: false }
  },
  // Flip the switch. The caller is responsible for showing the consent modal BEFORE
  // enabling — this is the apply, not the ask.
  async set(enabled: boolean): Promise<VoiceStatus> {
    return (await bridge()?.set(enabled)) ?? { enabled: false, running: false, starting: false, stillListening: false }
  },
  // Subscribe to main-side pushes (e.g. the orb reflecting a Settings change).
  onStatus(cb: (s: VoiceStatus) => void): () => void {
    return bridge()?.onStatus(cb) ?? (() => {})
  },
}
