// VortexOrb — the WebGL vortex orb (redesign Stage 7). Creates the Three.js
// scene once on mount, drives it from a single ~30fps rAF loop that reads {state,
// volume} through refs (so prop changes never recreate the scene), pauses when
// the window is hidden, and disposes the GL context on unmount. Falls back to the
// CSS orb if a WebGL context can't be created at runtime.
import { useEffect, useRef, useState } from "react"
import { createOrbScene } from "./three/createOrbScene"
import { CssMiniOrb } from "./CssMiniOrb"
import type { OrbState } from "../../lib/orbTypes"

export function VortexOrb({ state, volume, size = 220 }: { state: OrbState; volume: number; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const stateRef = useRef(state)
  const volRef = useRef(volume)
  stateRef.current = state
  volRef.current = volume

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scene = createOrbScene(canvas, size)
    if (!scene) {
      setFailed(true)
      return
    }
    let raf = 0
    let start = 0
    let last = 0
    const FRAME = 1000 / 30 // ~30fps cap (GPU/VRAM budget)
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop)
      if (!start) start = ts
      if (ts - last < FRAME) return
      last = ts
      if (document.hidden) return // pause when the window is hidden
      scene.setInputs(stateRef.current, volRef.current)
      scene.render((ts - start) / 1000)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      scene.dispose()
    }
  }, [size])

  if (failed) return <CssMiniOrb state={state} volume={volume} size={size} />
  return <canvas ref={canvasRef} width={size} height={size} style={{ width: size, height: size }} />
}
