import { useCallback, useEffect, useRef, useState, type RefObject } from "react"
import { createCadScene, type CadPart, type CadSceneController } from "./cadScene"

// useCadScene — the React lifecycle around the pure three.js CAD controller (lib/cadScene),
// lifted out of CadViewer so the LAB shell can render the 3D canvas (center viewport) and
// the explode / isolate / visibility controls (right Inspector) as SEPARATE regions driven
// by one shared controller. CadViewer keeps its own self-contained copy for the standalone
// CAD tab until that tab folds into LAB → Mechanical (M-CADfold), at which point this hook
// is the sole path and the duplication is removed.
export interface CadScene {
  canvasRef: RefObject<HTMLCanvasElement>
  parts: CadPart[]
  explode: number
  setExplode: (v: number) => void
  isolated: string | null
  setIsolated: (name: string | null) => void
  setPartVisible: (name: string, visible: boolean) => void
  reset: () => void
  bounds: [number, number, number] | null
  error: string | null
}

export function useCadScene(glb: ArrayBuffer | null): CadScene {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ctrlRef = useRef<CadSceneController | null>(null)
  const [parts, setParts] = useState<CadPart[]>([])
  const [explode, setExplodeState] = useState(0)
  const [isolated, setIsolatedState] = useState<string | null>(null)
  const [bounds, setBounds] = useState<[number, number, number] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Create the three.js scene once, tied to the canvas; dispose on unmount. (Verbatim from
  // the original CadViewer mount effect.)
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

  // Load a new GLB whenever the bytes change; reset the explode/isolate UI to assembled.
  useEffect(() => {
    const ctrl = ctrlRef.current
    if (!ctrl) return
    if (!glb) {
      ctrl.clear()
      setParts([])
      setExplodeState(0)
      setIsolatedState(null)
      setBounds(null)
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
        setExplodeState(0)
        setIsolatedState(null)
        ctrl.setExplode(0)
        ctrl.setIsolated(null)
        ctrl.resize()
        setBounds(ctrl.getBounds())
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [glb])

  const setExplode = useCallback((v: number) => {
    setExplodeState(v)
    ctrlRef.current?.setExplode(v)
  }, [])
  const setIsolated = useCallback((name: string | null) => {
    setIsolatedState(name)
    ctrlRef.current?.setIsolated(name)
  }, [])
  const setPartVisible = useCallback((name: string, visible: boolean) => {
    ctrlRef.current?.setPartVisible(name, visible)
    setParts((prev) => prev.map((p) => (p.name === name ? { ...p, visible } : p)))
  }, [])
  const reset = useCallback(() => {
    setExplode(0)
    setIsolated(null)
    ctrlRef.current?.frameAll()
  }, [setExplode, setIsolated])

  return { canvasRef, parts, explode, setExplode, isolated, setIsolated, setPartVisible, reset, bounds, error }
}
