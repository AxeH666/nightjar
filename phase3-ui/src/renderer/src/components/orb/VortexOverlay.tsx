// VortexOverlay — the Siri-style full-screen voice takeover (redesign Stage 7,
// replacing OrbOverlay). Whenever the pipeline is active (state !== idle) the orb
// scales up over a dimmed app, then shrinks back out on idle. The WebGL vortex is
// mounted ONLY while visible (and kept briefly after idle so the exit transition
// plays), so WebGL runs only during real voice turns — critical on the ~6GB box.
// z-40, one below PermissionPanel's z-50, so an approval ask still surfaces over
// an active voice turn.
import { useEffect, useRef, useState } from "react"
import type { OrbState } from "../../lib/orbTypes"
import { VortexOrb } from "./VortexOrb"
import { CssMiniOrb } from "./CssMiniOrb"

const LABELS: Record<OrbState, string> = {
  idle: "idle",
  connecting: "thinking…",
  listening: "listening…",
  speaking: "speaking…",
  error: "voice offline",
}

// Prefer the lightweight CSS orb when the user asks for reduced motion, or via a
// runtime kill switch (localStorage nj.orbWebGL="off") — no rebuild needed.
function preferCss(): boolean {
  if (typeof window === "undefined") return true
  try {
    if (localStorage.getItem("nj.orbWebGL") === "off") return true
  } catch {
    /* ignore */
  }
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
}

export function VortexOverlay({ state, volume, active }: { state: OrbState; volume: number; active: boolean }) {
  // Keep mounted briefly after going idle so the exit transition plays; unmount
  // the WebGL orb once fully idle so nothing runs at rest.
  const [mounted, setMounted] = useState(active)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (active) {
      if (timer.current) clearTimeout(timer.current)
      setMounted(true)
    } else {
      timer.current = setTimeout(() => setMounted(false), 400)
    }
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [active])

  const css = preferCss()

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
        {mounted &&
          (css ? <CssMiniOrb state={state} volume={volume} size={220} /> : <VortexOrb state={state} volume={volume} size={220} />)}
      </div>
      <span className="text-sm uppercase tracking-[0.2em] text-nightjar-text/70">{LABELS[state] ?? state}</span>
    </div>
  )
}
