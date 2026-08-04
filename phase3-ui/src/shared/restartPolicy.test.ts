import { describe, test, expect } from "vitest"
import { canRestart, RESTARTABLE_STATES } from "./restartPolicy"

// NJ-66: the restartable-state rule used to live only in HealthStrip.tsx's JSX, so
// `ipcMain.handle("nightjar:restart")` honoured any name in any state. Now both sides import
// this. The test pins the policy across the FULL ServiceState union (supervisor.ts:108-109) so
// a state added later is a deliberate decision rather than an accidental allow.

const ALL_STATES = [
  "pending",
  "starting",
  "healthy",
  "unhealthy",
  "restarting",
  "stopped",
  "failed",
  "adopted",
] as const

describe("restart policy (NJ-66)", () => {
  test("exactly failed and unhealthy are restartable", () => {
    const allowed = ALL_STATES.filter(canRestart)
    expect(allowed).toEqual(["unhealthy", "failed"])
  })

  test("every other state is refused", () => {
    for (const s of ["pending", "starting", "healthy", "restarting", "stopped", "adopted"]) {
      expect(canRestart(s)).toBe(false)
    }
  })

  // A live restart passes through `starting`, and `restarting` means crash-backoff (set at
  // supervisor.ts:296), not a manual restart. Both must stay refused, so the gate cannot be
  // mistaken for a re-entrancy guard — restartService's single-flight owns that.
  test("transient states are not restartable", () => {
    expect(canRestart("starting")).toBe(false)
    expect(canRestart("restarting")).toBe(false)
  })

  // A wake-daemon with voice off sits in `stopped`. It must be started through the consent
  // path, never kicked back to life via the restart channel.
  test("stopped is refused, so a disabled service cannot be restarted into existence", () => {
    expect(canRestart("stopped")).toBe(false)
  })

  test("unknown / malformed states are refused rather than throwing", () => {
    for (const s of ["", "HEALTHY", "failed ", "__proto__", "toString"]) {
      expect(canRestart(s)).toBe(false)
    }
  })

  test("the exported list and the predicate agree", () => {
    for (const s of RESTARTABLE_STATES) expect(canRestart(s)).toBe(true)
    expect(RESTARTABLE_STATES.length).toBe(2)
  })
})
