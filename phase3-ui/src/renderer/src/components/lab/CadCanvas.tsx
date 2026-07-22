import type { RefObject } from "react"

// The CAD 3D viewport for the LAB shell — canvas ONLY. The explode / isolate / visibility
// controls now live in the right Inspector (CadInspector), driven by the same useCadScene
// controller. Carries the former standalone CAD viewer's viewport overlays: a "Building model…" busy state, an
// empty hint, and a GLB parse-error banner.
export function CadCanvas({
  canvasRef,
  busy,
  error,
  hasModel,
}: {
  canvasRef: RefObject<HTMLCanvasElement>
  busy?: boolean
  error: string | null
  hasModel: boolean
}) {
  return (
    <div className="relative h-full min-h-0">
      <canvas ref={canvasRef} className="h-full w-full" />
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center bg-nightjar-base/40 text-sm text-nightjar-text/70">
          Building model…
        </div>
      )}
      {!busy && !hasModel && !error && (
        <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-nightjar-text/40">
          Describe a part or assembly in the prompt below — it renders here once built.
        </div>
      )}
      {error && (
        <div className="absolute inset-x-0 top-0 m-3 rounded-lg border border-nightjar-alert/40 bg-nightjar-alert/10 px-3 py-2 text-xs text-nightjar-text/80">
          Couldn't display the model: {error}
        </div>
      )}
    </div>
  )
}
