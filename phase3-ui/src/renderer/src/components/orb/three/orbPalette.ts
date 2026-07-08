// orbPalette — the vortex orb's colors, read from the SAME theme source of truth
// as everything else (the --nj-* CSS custom properties in index.css), so the orb
// tracks the green/silver/black theme automatically. Falls back to hardcoded
// green if the vars can't be read (SSR / very early mount).
import * as THREE from "three"
import type { OrbState } from "../../../lib/orbTypes"

function cssColor(varName: string, fallback: [number, number, number]): THREE.Color {
  let rgb = fallback
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
    const m = raw.match(/(\d+)\s+(\d+)\s+(\d+)/)
    if (m) rgb = [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  return new THREE.Color(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255)
}

export interface StateColors {
  core: THREE.Color
  edge: THREE.Color
}

export function orbColors() {
  const accent = cssColor("--nj-accent", [57, 211, 83]) // #39D353
  const alert = cssColor("--nj-alert", [229, 72, 77]) // #E5484D
  const bright = accent.clone().lerp(new THREE.Color(1, 1, 1), 0.45) // pale bright green
  const deep = accent.clone().multiplyScalar(0.22) // deep green edge

  const perState: Record<OrbState, StateColors> = {
    idle: { core: accent.clone().multiplyScalar(0.7), edge: deep.clone() },
    connecting: { core: accent.clone(), edge: deep.clone() },
    listening: { core: bright.clone(), edge: accent.clone().multiplyScalar(0.4) },
    speaking: { core: bright.clone(), edge: accent.clone().multiplyScalar(0.5) },
    error: { core: alert.clone(), edge: alert.clone().multiplyScalar(0.3) },
  }

  return {
    accent: accent.clone(),
    forState: (s: OrbState): StateColors => perState[s] ?? perState.idle,
  }
}
