// Renderer-side client for the voice master switch (NJ-57). Thin typed accessor over
// the preload bridge; the main process owns the pref and the wake-daemon lifecycle
// (enable = spawn, disable = KILL — the OS mic indicator is the source of truth).

export interface VoiceStatus {
  enabled: boolean
}

interface VoiceBridge {
  get(): Promise<VoiceStatus>
  set(enabled: boolean): Promise<VoiceStatus>
  onStatus(cb: (s: VoiceStatus) => void): () => void
}

function bridge(): VoiceBridge | null {
  return (window as unknown as { nightjar?: { voice?: VoiceBridge } }).nightjar?.voice ?? null
}

export const voice = {
  // Current state; disabled when the bridge is absent (renderer outside the app).
  async get(): Promise<VoiceStatus> {
    return (await bridge()?.get()) ?? { enabled: false }
  },
  // Flip the switch. The caller is responsible for showing the consent modal BEFORE
  // enabling — this is the apply, not the ask.
  async set(enabled: boolean): Promise<VoiceStatus> {
    return (await bridge()?.set(enabled)) ?? { enabled: false }
  },
  // Subscribe to main-side pushes (e.g. the orb reflecting a Settings change).
  onStatus(cb: (s: VoiceStatus) => void): () => void {
    return bridge()?.onStatus(cb) ?? (() => {})
  },
}
