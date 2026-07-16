// Main-process bridge to the trusted STEP → GLB converter (Task 5).
//
// The build123d-mcp `export` tool can only emit STEP (no GLB), and its sandbox blocks
// file writes anyway — so the model produces a STEP file, and THIS converts it to a GLB the
// three.js viewer loads. The conversion runs OUTSIDE the mcp sandbox (it's Nightjar's own
// code) via the phase-cad venv, which has build123d. See phase-cad/step_to_glb.py for the
// two upstream footguns it defends against (NJ-18: rebuild the tree; validate the bytes).
import { execFile } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { REPO, venvPython } from "./services"

// rule 3: a hard wall-clock cap on the conversion subprocess. build123d meshing on a
// pathological input could otherwise hang; execFile's `timeout` SIGKILLs it. OCCT tessellation
// of a normal part is sub-second, so 60s is generous headroom, not a target.
const CONVERT_TIMEOUT_MS = 60_000
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024 // the converter prints one small JSON line; cap defensively

export interface CadConvertResult {
  ok: boolean
  glbPath?: string
  parts?: string[] // per-part node names (the exploded view keys off these)
  nodes?: number
  meshes?: number
  error?: string
}

// Read a converted GLB off disk so the renderer can load it via GLTFLoader.parse — the
// renderer can't fetch an arbitrary file:// path (CSP + Electron blocks file navigation), so
// the bytes come over IPC. Returns a Uint8Array (structured-clonable to the renderer).
export async function readGlb(glbPath: string): Promise<Uint8Array | null> {
  try {
    const buf = await readFile(glbPath)
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  } catch {
    return null
  }
}

function pyPath(): string {
  return venvPython(join(REPO, "phase-cad", ".venv"))
}
function converterScript(): string {
  return join(REPO, "phase-cad", "step_to_glb.py")
}
function heroScript(): string {
  return join(REPO, "phase-cad", "hero_planetary_gearset.py")
}

export interface CadModelResult {
  ok: boolean
  glb?: Uint8Array // GLB bytes for the viewer (GLTFLoader.parse)
  parts?: string[]
  error?: string
}

// Build the pre-authored planetary-gearset hero (Task 5 demo) directly — no model, no
// permission prompts — then convert + read it. This makes the demo 100% reliable: the
// complex exploding assembly is a known-good script, not open-generated live.
export function buildHeroModel(): Promise<CadModelResult> {
  return new Promise((resolve) => {
    let stepPath: string
    try {
      stepPath = join(mkdtempSync(join(tmpdir(), "nightjar-cad-hero-")), "hero.step")
    } catch (e) {
      resolve({ ok: false, error: `could not create a temp dir: ${e instanceof Error ? e.message : String(e)}` })
      return
    }
    execFile(
      pyPath(),
      [heroScript(), "--export", stepPath],
      { timeout: CONVERT_TIMEOUT_MS, killSignal: "SIGKILL", windowsHide: true },
      async (err) => {
        if (err) {
          resolve({
            ok: false,
            error: `couldn't build the demo model (${err.message}). Is the phase-cad env set up? Run phase-cad/setup.sh.`,
          })
          return
        }
        const conv = await convertStepToGlb(stepPath)
        if (!conv.ok || !conv.glbPath) {
          resolve({ ok: false, error: conv.error || "demo conversion failed" })
          return
        }
        const bytes = await readGlb(conv.glbPath)
        if (!bytes) {
          resolve({ ok: false, error: "couldn't read the demo model." })
          return
        }
        resolve({ ok: true, glb: bytes, parts: conv.parts })
      },
    )
  })
}

// Convert a STEP file to a GLB in a fresh temp dir. Resolves with a structured result
// (never rejects) so the renderer always gets a clean {ok:false,error} on any failure —
// a missing venv, a timeout, an empty model, or malformed output.
export function convertStepToGlb(stepPath: string): Promise<CadConvertResult> {
  return new Promise((resolve) => {
    let glbPath: string
    try {
      glbPath = join(mkdtempSync(join(tmpdir(), "nightjar-cad-")), "model.glb")
    } catch (e) {
      resolve({ ok: false, error: `could not create a temp dir: ${e instanceof Error ? e.message : String(e)}` })
      return
    }

    execFile(
      pyPath(),
      [converterScript(), stepPath, glbPath],
      { timeout: CONVERT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, killSignal: "SIGKILL", windowsHide: true },
      (err, stdout) => {
        // The converter always prints one JSON line ({ok:true,...} or {ok:false,error}).
        // Parse that first — it's the authoritative result even when the process exits
        // non-zero (ok:false is signalled by exit 1). Fall back to the spawn error only
        // when there's no parseable line (missing interpreter, SIGKILL on timeout, etc.).
        const line = (stdout || "").trim().split("\n").filter(Boolean).pop()
        if (line) {
          try {
            const parsed = JSON.parse(line) as { ok: boolean; parts?: string[]; nodes?: number; meshes?: number; error?: string; glb?: string }
            if (parsed.ok) {
              resolve({ ok: true, glbPath, parts: parsed.parts, nodes: parsed.nodes, meshes: parsed.meshes })
            } else {
              resolve({ ok: false, error: parsed.error || "conversion failed" })
            }
            return
          } catch {
            /* not JSON — fall through to the spawn-error path */
          }
        }
        if (err) {
          const timedOut = (err as NodeJS.ErrnoException & { killed?: boolean }).killed
          resolve({
            ok: false,
            error: timedOut
              ? `STEP→GLB conversion timed out after ${CONVERT_TIMEOUT_MS / 1000}s (aborted).`
              : `STEP→GLB converter failed to run (${err.message}). Is the phase-cad env set up? Run phase-cad/setup.sh.`,
          })
          return
        }
        resolve({ ok: false, error: "STEP→GLB converter produced no result." })
      },
    )
  })
}
