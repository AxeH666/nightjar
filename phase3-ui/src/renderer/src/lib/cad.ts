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
  readGlb(glbPath: string): Promise<Uint8Array | null>
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
  // Read a converted GLB's bytes as an ArrayBuffer for GLTFLoader.parse (null on failure).
  async readGlbBytes(glbPath: string): Promise<ArrayBuffer | null> {
    const u8 = await bridge()?.readGlb(glbPath)
    if (!u8) return null
    // Copy into a standalone ArrayBuffer (the IPC Uint8Array may be a view over a pooled buffer).
    return u8.slice().buffer
  },
  // Convert a STEP then read the resulting GLB in one step — what the CAD flow uses.
  async buildModel(stepPath: string): Promise<{ glb: ArrayBuffer; parts: string[] } | { error: string }> {
    const res = await this.convert(stepPath)
    if (!res.ok || !res.glbPath) return { error: res.error || "conversion failed" }
    const glb = await this.readGlbBytes(res.glbPath)
    if (!glb) return { error: "could not read the converted model." }
    return { glb, parts: res.parts ?? [] }
  },
}
