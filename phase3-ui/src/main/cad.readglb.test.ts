import { describe, test, expect, beforeAll, afterAll } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve, sep } from "node:path"
import { isAllowedGlbPath, readGlb } from "./cad"

// NJ-61: `cad:readGlb` is renderer-reachable (preload → main) and, before this guard, called
// readFile() on whatever absolute path it was handed — it returned the bytes of ANY file the
// main process could read. It was the only renderer-reachable readFile in main with no guard
// of any kind (readAudio is root+extension guarded, readGeneratedImage is basename-guarded,
// the preview server routes through safeResolve; readAttachment is deliberately unguarded per
// its own comment and is NOT touched here).
//
// The load-bearing test is the FIRST one: it re-triggers the actual exploit (rule 6), not a
// re-reading of the guard. Everything else pins the guard's edges.

describe("readGlb path guard (NJ-61)", () => {
  let outsideDir: string
  let secretFile: string
  let tmpGlb: string
  let tmpTxt: string

  beforeAll(() => {
    // A directory that is NOT under os.tmpdir() — this is what the exploit read.
    outsideDir = mkdtempSync(join(homedir(), "njtest-"))
    secretFile = join(outsideDir, "not-a-glb.txt")
    writeFileSync(secretFile, "SENSITIVE MATERIAL")

    const inTmp = mkdtempSync(join(tmpdir(), "njtest-cad-"))
    tmpGlb = join(inTmp, "model.glb")
    writeFileSync(tmpGlb, "glb-bytes")
    tmpTxt = join(inTmp, "secret.txt")
    writeFileSync(tmpTxt, "nope")
  })

  afterAll(() => {
    try {
      rmSync(outsideDir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  })

  // THE HAZARD. Before the guard this resolved to the file's bytes.
  test("refuses a non-GLB file outside the allowed root (the exploit)", async () => {
    expect(await readGlb(secretFile)).toBeNull()
  })

  test("refuses a GLB-named file outside the allowed root", async () => {
    expect(isAllowedGlbPath(join(outsideDir, "x.glb"))).toBe(false)
  })

  // The positive case: the ONLY shape convertStepToGlb actually mints.
  test("admits a .glb inside a temp dir, and reads it", async () => {
    expect(isAllowedGlbPath(tmpGlb)).toBe(true)
    const bytes = await readGlb(tmpGlb)
    expect(bytes).not.toBeNull()
    expect(Buffer.from(bytes!).toString()).toBe("glb-bytes")
  })

  test("refuses a non-GLB extension even inside the allowed root", () => {
    expect(isAllowedGlbPath(tmpTxt)).toBe(false)
  })

  // Collapsed traversal: resolve() must run BEFORE the prefix test.
  test("refuses traversal that escapes the root once resolved", () => {
    expect(isAllowedGlbPath(join(tmpdir(), "..", "..", "escaped.glb"))).toBe(false)
  })

  // Regression guard for the trailing `sep` on each root. Drop it and this passes.
  test("refuses a sibling directory that merely shares the root's prefix", () => {
    expect(isAllowedGlbPath(resolve(tmpdir()) + "-evil" + sep + "x.glb")).toBe(false)
  })

  // IPC payloads are structured-clone, so a non-string can arrive. Must refuse, not throw.
  test("refuses non-string payloads without throwing", async () => {
    for (const bad of [undefined, null, 0, {}, ["x.glb"]]) {
      expect(isAllowedGlbPath(bad)).toBe(false)
      expect(await readGlb(bad as unknown as string)).toBeNull()
    }
  })

  test("refuses a relative path (resolves against cwd, not the root)", () => {
    expect(isAllowedGlbPath("model.glb")).toBe(false)
  })
})
