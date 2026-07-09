// VortexOrb — the WebGL vortex orb (redesign Stage 7). Mounts a FRESH canvas per
// effect run, builds the Three.js scene on it, drives it from a single ~30fps rAF
// loop that reads {state, volume} through refs (so prop changes never recreate the
// scene), pauses when the window is hidden, and disposes the GL context on
// unmount. Falls back to the CSS orb if a WebGL context can't be created — at init
// or on a runtime context loss.
import { useEffect, useRef, useState } from "react"
import { createOrbScene } from "./three/createOrbScene"
import { CssMiniOrb } from "./CssMiniOrb"
import type { OrbState } from "../../lib/orbTypes"

export function VortexOrb({ state, volume, size = 220 }: { state: OrbState; volume: number; size?: number }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const stateRef = useRef(state)
  const volRef = useRef(volume)
  stateRef.current = state
  volRef.current = volume

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    // A NEW canvas each mount. React.StrictMode (dev) runs this effect as
    // mount → cleanup → mount on the SAME component, and dispose() calls
    // forceContextLoss(), which permanently kills a canvas's GL context — a
    // reused canvas would then fail its second init (blank orb / sticky CSS
    // fallback for the whole session). A throwaway element per run keeps mounts
    // independent. (Bugbot: "Strict Mode breaks canvas reuse".)
    const canvas = document.createElement("canvas")
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    canvas.style.display = "block"
    host.appendChild(canvas)

    const scene = createOrbScene(canvas, size)
    if (!scene) {
      canvas.remove()
      setFailed(true)
      return
    }
    setFailed(false)

    let raf = 0
    let torn = false
    // One idempotent teardown, shared by the context-loss degrade path and the
    // effect cleanup. scene.dispose() calls forceContextLoss(), so it must run
    // exactly once — the `torn` guard makes a second call (degrade THEN unmount)
    // a no-op.
    const teardown = () => {
      if (torn) return
      torn = true
      cancelAnimationFrame(raf)
      canvas.removeEventListener("webglcontextlost", onContextLost)
      scene.dispose()
      canvas.remove()
    }

    // A runtime context loss (GPU reset, driver kill, too long backgrounded)
    // otherwise freezes the canvas. This VortexOrb instance stays mounted on
    // degrade (only its subtree swaps to CssMiniOrb), so the [size]-keyed cleanup
    // won't fire — stop the rAF loop and release the GL context HERE, then fall
    // back to the CSS orb. Without this the loop would keep rendering to a dead
    // context and the renderer would leak until VortexOrb fully unmounts.
    const onContextLost = (e: Event) => {
      e.preventDefault()
      teardown()
      setFailed(true)
    }
    canvas.addEventListener("webglcontextlost", onContextLost, false)

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
    return teardown
  }, [size])

  if (failed) return <CssMiniOrb state={state} volume={volume} size={size} />
  return <div ref={hostRef} style={{ width: size, height: size }} />
}
