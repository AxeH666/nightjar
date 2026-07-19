import { describe, test, expect } from "vitest"
import { Supervisor, type ServiceDef } from "./supervisor"

// audit1.md P0-2: when a service's source/binary is absent (the OpenCode engine tree
// missing on a fresh clone was the real incident), the supervisor must mark it `failed`
// with an actionable message and NEVER spawn it — no opaque bun crash-restart loop that
// exhausts the restart budget into "restarts exhausted". The `preflight` hook is the fix;
// these tests drive that exact failure mode headlessly (no real process, no network).
describe("Supervisor preflight (audit1.md P0-2)", () => {
  test("a failing preflight marks the service failed, never spawns, burns no restart budget", async () => {
    const def: ServiceDef = {
      name: "opencode-serve",
      // If preflight were skipped and spawn proceeded, this bogus command would be run
      // (and error). Preflight must short-circuit before spawn() ever touches it.
      command: "definitely-not-a-real-binary-xyz",
      args: [],
      ready: async () => false, // never healthy → bring() falls through to spawn()
      preflight: () => "OpenCode engine source not found at X — run setup to fetch the engine submodule",
      autoRestart: true,
      maxRestarts: 5,
    }
    const sup = new Supervisor([def])
    await sup.start()

    const s = sup.status()[0]
    expect(s.state).toBe("failed")
    expect(s.detail).toContain("run setup")
    expect(s.pid).toBeUndefined() // never spawned
    expect(s.restarts).toBe(0) // no crash-restart budget consumed
  })

  test("preflight only gates spawn, never adopt: an already-running instance is adopted", async () => {
    // ready() true → bring() adopts BEFORE reaching spawn(), so preflight is never consulted
    // and an already-serving engine is adopted regardless of preflight (a stray/dev engine
    // on :4096 must not be marked failed just because our local source check would fail).
    let preflightCalls = 0
    const def: ServiceDef = {
      name: "opencode-serve",
      command: "unused-on-adopt-path",
      args: [],
      ready: async () => true, // already healthy → adopt path
      preflight: () => {
        preflightCalls++
        return "should never be consulted on the adopt path"
      },
    }
    const sup = new Supervisor([def])
    await sup.start()

    const s = sup.status()[0]
    expect(s.state).toBe("adopted")
    expect(preflightCalls).toBe(0)

    await sup.stop() // clear the adopt health-watch interval
  }, 10000)
})
