import { describe, test, expect } from "vitest"
import { nightjarServices } from "./services"

// NJ-34: OpenCode substitutes {env:NIGHTJAR_ROOT} and {env:HOME} into opencode.json STRING values
// (MCP command paths, {env:HOME}/.nightjar data dirs) and parses the result as JSONC. A native-
// Windows backslash path there is an invalid JSON escape (\d, \n, …) → the config fails to parse
// → /agent 400 → the supervisor never marks opencode-serve healthy → chat never connects. So the
// opencode-serve env must feed forward-slash paths. (Trivially true on POSIX; the real guard is
// on Windows, where REPO/HOME are backslash paths that must be normalized.)
describe("opencode-serve env path normalization (NJ-34)", () => {
  const oc = nightjarServices().find((s) => s.name === "opencode-serve")

  test("opencode-serve is defined with an env overlay", () => {
    expect(oc).toBeTruthy()
    expect(oc?.env).toBeTruthy()
  })

  test("NIGHTJAR_ROOT and HOME contain no backslashes (valid inside opencode.json JSON strings)", () => {
    const env = oc!.env!
    expect(env.NIGHTJAR_ROOT, "NIGHTJAR_ROOT must be set").toBeTruthy()
    expect(env.NIGHTJAR_ROOT).not.toContain("\\")
    expect(env.HOME, "HOME must be injected (also fixes the data-dir divergence, P1-1)").toBeTruthy()
    expect(env.HOME).not.toContain("\\")
  })
})
