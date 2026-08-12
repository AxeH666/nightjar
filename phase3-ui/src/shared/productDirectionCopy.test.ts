import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const activeProductSurfaces = [
  "README.md",
  "PROJECT_CONTEXT.md",
  "NIGHTJAR_LICENSE_AND_ATTRIBUTION.md",
  "engine-workspace/opencode.json",
  "phase2-mcp/web_search_backend.py",
  "phase3-ui/src/renderer/src/components/BYOKSettings.tsx",
  "phase3-ui/src/renderer/src/components/CloudBanner.tsx",
  "phase3-ui/src/renderer/src/components/lab/ProjectView.tsx",
]

function read(relativePath: string): string {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), "utf8")
}

describe("NJ-93 product direction copy", () => {
  it("keeps retired local-first promises out of active product surfaces", () => {
    for (const path of activeProductSurfaces) {
      const copy = read(path).replace(/\s+/g, " ")
      expect(copy, path).not.toMatch(/\blocal[- ]first\b/i)
      expect(copy, path).not.toMatch(/\bfully offline\b/i)
      expect(copy, path).not.toMatch(/\bnothing leaves\b/i)
      expect(copy, path).not.toMatch(/\balways stay on[- ]device\b/i)
      expect(copy, path).not.toMatch(/\bnever sent to the cloud\b/i)
    }
  })

  it("states the cloud-first, quality-first direction in the primary README", () => {
    const readme = read("README.md")
    expect(readme).toMatch(/cloud-first/i)
    expect(readme).toMatch(/quality-first/i)
  })

  it("marks retained local-first plans as superseded historical evidence", () => {
    for (const path of ["JUNE_context.md", "JUNE_better.md"]) {
      const banner = read(path).split("\n").slice(0, 12).join(" ")
      expect(banner, path).toMatch(/superseded by NJ-93/i)
      expect(banner, path).toMatch(/cloud-first/i)
      expect(banner, path).toMatch(/quality-first/i)
    }
  })
})
