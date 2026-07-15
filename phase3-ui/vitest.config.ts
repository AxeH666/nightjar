import { defineConfig } from "vitest/config"

// Unit tests for PURE renderer logic only (no React, no Electron, no DOM). The plan calls
// for real tests on the global-mode derivation, capability-support, and image-availability
// helpers; this is the runner for them. Kept scoped to *.test.ts so it never tries to load
// component or main-process code.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
