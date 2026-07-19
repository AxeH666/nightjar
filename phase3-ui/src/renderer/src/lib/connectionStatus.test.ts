import { describe, test, expect } from "vitest"
import { connectingHint, SLOW_ATTEMPTS } from "./connectionStatus"

// audit1.md P2-8: the connect loop must not loop the optimistic "still starting…" message
// forever. Once the supervisor marks the engine `failed`, or ~90s elapse, say something honest
// that points at the diagnostics — while still retrying.
describe("connectingHint (P2-8)", () => {
  test("early attempts show the calm cold-start message", () => {
    expect(connectingHint(0, undefined, undefined)).toBe("starting the local engine…")
    expect(connectingHint(2, "starting", undefined)).toBe("starting the local engine…")
  })

  test("mid attempts (<~90s) show the 'can take a minute' message", () => {
    expect(connectingHint(10, "starting", undefined)).toContain("can take a minute")
    expect(connectingHint(SLOW_ATTEMPTS - 1, undefined, undefined)).toContain("can take a minute")
  })

  test("after ~90s with no connection, surface an honest 'still not responding' state", () => {
    const h = connectingHint(SLOW_ATTEMPTS, undefined, undefined)
    expect(h).toContain("isn't responding after ~90s")
    expect(h).toContain("Services strip")
  })

  test("a supervisor-'failed' engine is surfaced immediately with its detail, not the cold-start hint", () => {
    const h = connectingHint(1, "failed", "engine source not found — run setup")
    expect(h).toContain("failed to start")
    expect(h).toContain("engine source not found — run setup")
    expect(h).not.toContain("can take a minute")
  })

  test("'failed' overrides even a low attempt count and needs no detail", () => {
    const h = connectingHint(0, "failed", undefined)
    expect(h).toContain("failed to start")
    expect(h).toContain("re-run setup")
  })
})
