// AmberCircleTheme — Nightjar's fork of orb-ui's `circle` theme.
//
// orb-ui (MIT, © Alexander Chen) hard-codes the circle theme's per-state colors
// and does not expose them as a prop, so — exactly as Phase 4 scoped — we fork
// the theme file and swap ONLY the palette to Nightjar's amber
// (accent #C9852E / alert #A13D2B). The volume→scale/glow mapping, the 60fps
// rAF interpolation, the settle-to-idle handoff, and the keyframes are copied
// verbatim from orb-ui@0.2.4 src/themes/circle/CircleTheme.tsx so the motion
// matches upstream. Upstream source:
//   https://github.com/alexanderqchen/orb-ui  (MIT LICENSE preserved in node_modules/orb-ui)
//
// Rendered in controlled mode: it receives `state` + `volume` and animates.
import { useRef, useEffect, useLayoutEffect } from "react"
import type { CSSProperties } from "react"
import type { OrbState } from "orb-ui"

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

interface AmberCircleThemeProps {
  state: OrbState
  volume: number
  size: number
  className?: string
  style?: CSSProperties
}

// ─── Color helpers ────────────────────────────────────────────────────────────

type RGB = [number, number, number]

function hexToRgb(hex: string): RGB {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

// ── JUNE green palette (interim — this orb-ui fork is retired for the custom
// Three.js vortex orb in Stage 7; recolored now so the app stays coherent).
// idle: banked green (armed, waiting for the wake word) → connecting: accent
// (thinking) → listening: the accent green (expands toward the user's voice) →
// speaking: pale bright green (agent talking) → error: the reserved alert red.
const STATE_COLORS: Record<OrbState, string> = {
  idle: "#1E5A34",
  connecting: "#2FB24C",
  listening: "#39D353",
  speaking: "#8BF2A9",
  error: "#E5484D",
}

// ─── Keyframes ────────────────────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes orb-amber-idle-pulse {
  from { transform: scale(1); }
  to   { transform: scale(1.06); }
}
@keyframes orb-amber-connecting-pulse {
  0%   { opacity: 1; transform: scale(1); }
  50%  { opacity: 0.6; transform: scale(0.95); }
  100% { opacity: 1; transform: scale(1); }
}
`

// ─── Visual constants (verbatim from orb-ui) ──────────────────────────────────
const SPEAK_BASE = 0.95
const SPEAK_RANGE = 0.08
const LISTEN_BASE = 0.82
const LISTEN_RANGE = 0.18

const SPEAK_GLOW = 24
const LISTEN_GLOW = 0

const LERP = 0.55
const SETTLE_RATE = 0.12
const SETTLE_SCALE_EPSILON = 0.002

export function AmberCircleTheme({ state, volume, size, className, style }: AmberCircleThemeProps) {
  const circleRef = useRef<HTMLSpanElement>(null)
  const glowRef = useRef<HTMLSpanElement>(null)
  const rafRef = useRef<number>(0)

  const volumeRef = useRef(volume)
  useIsomorphicLayoutEffect(() => {
    volumeRef.current = volume
  }, [volume])

  const currentScaleRef = useRef(1)
  const currentGlowRef = useRef(0)
  const currentColorRef = useRef<RGB>(hexToRgb(STATE_COLORS.idle))

  const TRANSITION_RATE = 0.06
  const currentBaseRef = useRef(LISTEN_BASE)
  const currentRangeRef = useRef(LISTEN_RANGE)

  useEffect(() => {
    const id = "orb-amber-keyframes"
    if (!document.getElementById(id)) {
      const el = document.createElement("style")
      el.id = id
      el.textContent = KEYFRAMES
      document.head.appendChild(el)
    }
  }, [])

  useEffect(() => {
    const el = circleRef.current
    if (!el) return

    if (state === "listening" || state === "speaking") {
      const base = state === "speaking" ? SPEAK_BASE : LISTEN_BASE
      const range = state === "speaking" ? SPEAK_RANGE : LISTEN_RANGE
      const glow = state === "speaking" ? SPEAK_GLOW : LISTEN_GLOW

      const animate = () => {
        const vol = volumeRef.current

        currentBaseRef.current += (base - currentBaseRef.current) * TRANSITION_RATE
        currentRangeRef.current += (range - currentRangeRef.current) * TRANSITION_RATE

        const tScale = currentBaseRef.current + vol * currentRangeRef.current
        const tGlow = vol * glow

        if (state === "listening") {
          currentScaleRef.current += (tScale - currentScaleRef.current) * LERP
          currentGlowRef.current += (tGlow - currentGlowRef.current) * LERP
        } else {
          currentScaleRef.current = tScale
          currentGlowRef.current = tGlow
        }

        const tRgb = hexToRgb(STATE_COLORS[state])
        const [cr, cg, cb] = currentColorRef.current
        currentColorRef.current = [
          cr + (tRgb[0] - cr) * 0.05,
          cg + (tRgb[1] - cg) * 0.05,
          cb + (tRgb[2] - cb) * 0.05,
        ]
        const [r, g, b] = currentColorRef.current.map(Math.round)

        el.style.transform = `scale(${currentScaleRef.current})`
        el.style.background = `rgb(${r},${g},${b})`
        el.style.boxShadow = "none"
        el.style.animation = "none"

        const ge = glowRef.current
        if (ge) {
          const g2 = currentGlowRef.current
          ge.style.transform = `scale(${currentScaleRef.current})`
          ge.style.boxShadow = g2 > 0.5 ? `0 0 ${g2}px ${g2 * 0.4}px rgb(${r},${g},${b})` : "none"
        }

        rafRef.current = requestAnimationFrame(animate)
      }

      rafRef.current = requestAnimationFrame(animate)
      return () => cancelAnimationFrame(rafRef.current)
    } else {
      cancelAnimationFrame(rafRef.current)
      const c = STATE_COLORS[state] ?? STATE_COLORS.idle
      const tRgb = hexToRgb(c)

      const settle = () => {
        currentScaleRef.current += (1 - currentScaleRef.current) * SETTLE_RATE
        currentGlowRef.current += (0 - currentGlowRef.current) * SETTLE_RATE

        const [cr, cg, cb] = currentColorRef.current
        currentColorRef.current = [
          cr + (tRgb[0] - cr) * SETTLE_RATE,
          cg + (tRgb[1] - cg) * SETTLE_RATE,
          cb + (tRgb[2] - cb) * SETTLE_RATE,
        ]
        const [r, g, b] = currentColorRef.current.map(Math.round)

        el.style.transform = `scale(${currentScaleRef.current})`
        el.style.background = `rgb(${r},${g},${b})`
        el.style.boxShadow = "none"
        el.style.animation = "none"

        if (glowRef.current) {
          glowRef.current.style.transform = `scale(${currentScaleRef.current})`
          glowRef.current.style.boxShadow = "none"
        }

        const scaleDone = Math.abs(currentScaleRef.current - 1) < SETTLE_SCALE_EPSILON
        const glowDone = currentGlowRef.current < 0.1
        const colorDone = currentColorRef.current.every(
          (channel, i) => Math.abs(channel - tRgb[i]) < 1,
        )

        if (scaleDone && glowDone && colorDone) {
          currentScaleRef.current = 1
          currentGlowRef.current = 0
          currentColorRef.current = tRgb

          el.style.transform = ""
          el.style.boxShadow = "none"
          el.style.background = c
          if (glowRef.current) {
            glowRef.current.style.transform = "scale(1)"
            glowRef.current.style.boxShadow = "none"
          }

          if (state === "idle") {
            el.style.animation = "orb-amber-idle-pulse 3s ease-in-out infinite alternate"
          } else if (state === "connecting") {
            el.style.animation = "orb-amber-connecting-pulse 1.5s ease-in-out infinite"
          } else {
            el.style.animation = "none"
          }
          return
        }

        rafRef.current = requestAnimationFrame(settle)
      }

      rafRef.current = requestAnimationFrame(settle)
      return () => cancelAnimationFrame(rafRef.current)
    }
  }, [state])

  const d = size * 0.55
  const rootStyle: CSSProperties = {
    width: size,
    height: size,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    ...style,
  }

  return (
    <div className={className} style={rootStyle}>
      <span style={{ position: "relative", display: "inline-block", borderRadius: "50%", lineHeight: 0 }}>
        {/* Glow — behind the circle */}
        <span
          ref={glowRef}
          style={{
            position: "absolute",
            display: "block",
            width: d,
            height: d,
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />
        {/* Circle — on top */}
        <span
          ref={circleRef}
          style={{
            position: "relative",
            display: "block",
            width: d,
            height: d,
            borderRadius: "50%",
            background: STATE_COLORS[state],
          }}
        />
      </span>
    </div>
  )
}
