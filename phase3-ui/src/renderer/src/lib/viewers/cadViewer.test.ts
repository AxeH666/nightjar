import { describe, expect, it } from "vitest"
import { isCadExportTool, cadExportPath, matchCadExport } from "./cadViewer"
import type { ToolCall } from "../opencode"

// The CAD export match/extract drives the ONLY thing that fills the 3D viewer, and its .step regex was
// duplicated + untested before M3. Pin the exact behaviour (assert-then-mutate: change the regex and a
// case flips) so the extraction is provably byte-identical.

describe("isCadExportTool", () => {
  it("matches the export tool (namespaced or bare), case-insensitively; not other build tools", () => {
    expect(isCadExportTool("cad-build123d_export")).toBe(true)
    expect(isCadExportTool("build123d_export")).toBe(true)
    expect(isCadExportTool("BUILD123D_EXPORT")).toBe(true)
    expect(isCadExportTool("cad-build123d_execute")).toBe(false)
    expect(isCadExportTool("cad-build123d_render_view")).toBe(false)
    expect(isCadExportTool("")).toBe(false)
  })
})

describe("cadExportPath", () => {
  it("pulls the .step path from the single-line form, stopping before the volume/bbox suffix", () => {
    expect(cadExportPath("Exported to /home/u/.nightjar/cad/part.step (vol 1234 mm³)")).toBe("/home/u/.nightjar/cad/part.step")
  })
  it("pulls the FIRST .step from the multi-line 'Exported to:' list form", () => {
    expect(cadExportPath("Exported to:\n/tmp/assembly.step\n/tmp/other.step\n")).toBe("/tmp/assembly.step")
  })
  it("is null when there is no .step, and tolerant of empty/absent output", () => {
    expect(cadExportPath("Rendered a PNG at /tmp/view.png")).toBeNull()
    expect(cadExportPath("Exported to /tmp/part.stl")).toBeNull() // wrong extension
    expect(cadExportPath("")).toBeNull()
    expect(cadExportPath(null)).toBeNull()
    expect(cadExportPath(undefined)).toBeNull()
  })
})

describe("matchCadExport", () => {
  const call = (over: Partial<ToolCall>): ToolCall => ({ tool: "cad-build123d_export", status: "completed", output: "Exported to /a/b.step", callID: "c", ...over }) as ToolCall

  it("returns the path only for a COMPLETED export tool call whose output names a .step", () => {
    expect(matchCadExport(call({}))).toBe("/a/b.step")
    expect(matchCadExport(call({ status: "running" }))).toBeNull() // not terminal yet
    expect(matchCadExport(call({ tool: "cad-build123d_render_view" }))).toBeNull() // wrong tool
    expect(matchCadExport(call({ output: "no path here" }))).toBeNull() // no .step
  })
})
