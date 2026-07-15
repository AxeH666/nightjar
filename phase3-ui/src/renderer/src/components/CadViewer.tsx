import { useEffect, useRef, useState } from "react"
import { createCadScene, type CadPart, type CadSceneController } from "../lib/cadScene"

// The 3D CAD viewer (Task 5): loads the converter's GLB and gives the exploded-view /
// drill-down / reassemble controls. Pure presentation over lib/cadScene — it takes GLB
// bytes as a prop (the byte-fetch + prompt→export→convert flow is wired in the next PR),
// so the whole viewer is self-contained and testable in isolation.
export function CadViewer({ glb, busy }: { glb: ArrayBuffer | null; busy?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctrlRef = useRef<CadSceneController | null>(null)
  const [parts, setParts] = useState<CadPart[]>([])
  const [explode, setExplode] = useState(0)
  const [isolated, setIsolated] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Create the three.js scene once, tied to the canvas; dispose on unmount.
  useEffect(() => {
    if (!canvasRef.current) return
    const ctrl = createCadScene(canvasRef.current)
    ctrlRef.current = ctrl
    ctrl.resize()
    const onResize = () => ctrl.resize()
    window.addEventListener("resize", onResize)
    const ro = new ResizeObserver(() => ctrl.resize())
    if (canvasRef.current.parentElement) ro.observe(canvasRef.current.parentElement)
    return () => {
      window.removeEventListener("resize", onResize)
      ro.disconnect()
      ctrl.dispose()
      ctrlRef.current = null
    }
  }, [])

  // Load a new GLB whenever the bytes change. Reset the explode/isolate UI to assembled.
  useEffect(() => {
    const ctrl = ctrlRef.current
    if (!ctrl) return
    // glb → null: clear the model and the panel so we don't leave a stale model on canvas
    // with its parts sidebar still showing (Bugbot).
    if (!glb) {
      ctrl.clear()
      setParts([])
      setExplode(0)
      setIsolated(null)
      setError(null)
      return
    }
    let cancelled = false
    setError(null)
    ctrl
      .load(glb)
      .then((p) => {
        if (cancelled) return
        setParts(p)
        setExplode(0)
        setIsolated(null)
        ctrl.setExplode(0)
        ctrl.setIsolated(null)
        ctrl.resize()
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [glb])

  function onExplode(v: number) {
    setExplode(v)
    ctrlRef.current?.setExplode(v)
  }
  function onIsolate(name: string | null) {
    setIsolated(name)
    ctrlRef.current?.setIsolated(name)
  }
  function reset() {
    onExplode(0)
    onIsolate(null)
    ctrlRef.current?.frameAll()
  }

  const hasModel = parts.length > 0

  return (
    <div className="relative flex h-full min-h-0">
      {/* Viewport */}
      <div className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="h-full w-full" />
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-nightjar-base/40 text-sm text-nightjar-text/70">
            Building model…
          </div>
        )}
        {!busy && !hasModel && !error && (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-nightjar-text/40">
            Describe a part or assembly in the composer — it renders here once built.
          </div>
        )}
        {error && (
          <div className="absolute inset-x-0 top-0 m-3 rounded-lg border border-nightjar-alert/40 bg-nightjar-alert/10 px-3 py-2 text-xs text-nightjar-text/80">
            Couldn't display the model: {error}
          </div>
        )}
      </div>

      {/* Controls */}
      {hasModel && (
        <div className="flex w-56 flex-col gap-3 overflow-y-auto border-l border-nightjar-surface p-3 text-xs">
          <div>
            <label className="mb-1 flex items-center justify-between text-nightjar-text/70">
              <span>Explode</span>
              <span className="text-nightjar-text/40">{explode.toFixed(1)}×</span>
            </label>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={explode}
              onChange={(e) => onExplode(Number(e.target.value))}
              className="w-full accent-nightjar-accent"
            />
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-nightjar-text/70">Parts ({parts.length})</span>
            {parts.map((p) => (
              <div key={p.name} className="flex items-center gap-1">
                <button
                  onClick={() => onIsolate(isolated === p.name ? null : p.name)}
                  title={isolated === p.name ? "Show all parts" : "Show only this part"}
                  className={`flex-1 truncate rounded px-2 py-1 text-left ${
                    isolated === p.name ? "bg-nightjar-accent text-nightjar-base" : "hover:bg-nightjar-surface text-nightjar-text/80"
                  }`}
                >
                  {p.name}
                </button>
              </div>
            ))}
          </div>

          <button onClick={reset} className="rounded border border-nightjar-surface px-2 py-1 text-nightjar-text/70 hover:bg-nightjar-surface">
            Reset view
          </button>
          {isolated && (
            <p className="text-[11px] text-nightjar-text/40">
              Isolated: <b>{isolated}</b> — click it again or Reset to reassemble.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
