import { defineConfig } from "vitest/config"

// Unit tests for PURE logic only (no React, no Electron renderer, no DOM). The plan calls
// for real tests on the global-mode derivation, capability-support, and image-availability
// helpers; this is the runner for them. The src/**/*.test.ts glob also picks up the
// main-process suites (services.paths, services.opencode-env, supervisor.preflight) —
// they import Node-only module logic and run fine under environment: "node".
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
})
