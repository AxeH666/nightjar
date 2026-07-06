// OrbOverlay — the Siri-style full-screen voice overlay.
//
// The small header orb (NightjarOrb) is a persistent affordance; this is the
// second half of the "Hey Nightjar" experience: whenever the pipeline is
// actually active (listening/thinking/speaking/error), the orb scales up,
// floats centered over the whole app, and the rest of the UI dims behind it —
// then shrinks back out when it returns to idle. Same `fixed inset-0` overlay
// pattern PermissionPanel already uses (z-40, one below PermissionPanel's z-50,
// so an approval ask can still surface over an active voice turn).
//
// Always mounted (never conditionally removed from the tree) so opacity/
// transform transitions actually play on both the way in and the way out —
// conditionally unmounting would skip the exit animation.
import type { OrbState } from "orb-ui"
import { AmberCircleTheme } from "./AmberCircleTheme"

const LABELS: Record<OrbState, string> = {
  idle: "idle",
  connecting: "thinking…",
  listening: "listening…",
  speaking: "speaking…",
  error: "voice offline",
}

export function OrbOverlay({
  state,
  volume,
  active,
  size = 220,
}: {
  state: OrbState
  volume: number
  active: boolean
  size?: number
}) {
  return (
    <div
      aria-hidden={!active}
      className={`fixed inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
        active ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <div
        className="transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{ transform: active ? "scale(1)" : "scale(0.35)" }}
      >
        <AmberCircleTheme state={state} volume={volume} size={size} />
      </div>
      <span className="text-sm uppercase tracking-[0.2em] text-nightjar-text/70">
        {LABELS[state] ?? state}
      </span>
    </div>
  )
}
