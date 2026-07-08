// CssMiniOrb — the cheap always-on orb for the header, and the reduced-motion /
// no-WebGL fallback for the overlay (redesign Stage 7). Pure CSS: a radial-
// gradient disc that shifts color per state (reading the --nj-* theme vars) and
// scales/pulses with volume. No WebGL, so it costs nothing at idle — the heavy
// vortex only spins up during an actual voice turn.
import type { OrbState } from "../../lib/orbTypes"

// Colors reference the theme tokens (index.css :root), so this tracks the palette.
const STATE_COLOR: Record<OrbState, string> = {
  idle: "rgb(var(--nj-accent) / 0.55)",
  connecting: "rgb(var(--nj-accent) / 0.85)",
  listening: "rgb(var(--nj-accent))",
  speaking: "rgb(139 242 169)", // pale bright green (#8BF2A9)
  error: "rgb(var(--nj-alert))",
}

export function CssMiniOrb({ state, volume, size = 36 }: { state: OrbState; volume: number; size?: number }) {
  const color = STATE_COLOR[state] ?? STATE_COLOR.idle
  const active = state !== "idle"
  const scale = 1 + Math.min(0.35, (volume || 0) * 0.5) * (active ? 1 : 0.25)
  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "9999px",
        background: `radial-gradient(circle at 50% 45%, ${color}, transparent 70%)`,
        boxShadow: `0 0 ${Math.round(size * 0.5)}px ${color}`,
        transform: `scale(${scale})`,
        transition: "transform 120ms ease-out, background 300ms ease, box-shadow 300ms ease",
        animation: active ? "nj-orb-pulse 1.6s ease-in-out infinite" : undefined,
      }}
    />
  )
}
