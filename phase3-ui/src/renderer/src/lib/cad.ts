// Renderer-side client for the CAD STEP → GLB conversion (Task 5). Talks to the main
// process over the preload bridge; the actual convert runs in the phase-cad venv there.

export interface CadConvertResult {
  ok: boolean
  glbPath?: string // absolute path to the written GLB (loaded by the three.js viewer)
  parts?: string[] // per-part node names, for the exploded-view parts list
  nodes?: number
  meshes?: number
  error?: string
}

interface CadBridge {
  convert(stepPath: string): Promise<CadConvertResult>
}

function bridge(): CadBridge | null {
  return (window as unknown as { nightjar?: { cad?: CadBridge } }).nightjar?.cad ?? null
}

export const cad = {
  // Convert a STEP the CAD agent exported into a GLB. Returns a structured result; an
  // absent bridge (renderer outside the desktop app) yields a clean {ok:false}.
  async convert(stepPath: string): Promise<CadConvertResult> {
    return (await bridge()?.convert(stepPath)) ?? { ok: false, error: "CAD bridge unavailable." }
  },
}
