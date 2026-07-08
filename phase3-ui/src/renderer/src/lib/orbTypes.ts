// Orb adapter types — relocated off the orb-ui dependency (redesign Stage 7) so
// the custom Three.js orb can drop orb-ui entirely. The shapes are identical to
// orb-ui@0.2.4's (OrbState + the controlled-mode adapter contract), so
// lib/orbAdapter.ts and lib/useOrbAdapter.ts keep working unchanged except for
// this import path. The {state, volume} contract the orb consumes is preserved.
export type OrbState = "idle" | "connecting" | "listening" | "speaking" | "error"

export interface AdapterCallbacks {
  onStateChange: (state: OrbState) => void
  onVolumeChange: (volume: number) => void
}

export interface OrbAdapter {
  // Subscribe to state + volume changes. Returns an unsubscribe function.
  subscribe(callbacks: AdapterCallbacks): () => void
  start?: () => void | Promise<void>
  stop?: () => void | Promise<void>
}
