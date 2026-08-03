import { describe, test, expect } from "vitest"
import { spawn } from "node:child_process"
import net from "node:net"
import { Supervisor, type ServiceDef } from "./supervisor"

function tcpProbe(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    const done = (ok: boolean) => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(timeoutMs)
    sock.once("connect", () => done(true))
    sock.once("timeout", () => done(false))
    sock.once("error", () => done(false))
    sock.connect(port, "127.0.0.1")
  })
}

// NJ-57: the wake daemon (an open microphone) must be OPT-IN. These tests drive the
// supervisor's `enabled()` gate + startService/stopService lifecycle headlessly — the
// disable-must-KILL guarantee (OS mic indicator as source of truth) at the process-
// lifecycle level. The real-mic/indicator confirmation is the PR-6 hardware checklist.
describe("Supervisor enabled() gate (NJ-57)", () => {
  test("a disabled service is never spawned — state 'stopped', no restart budget burned", async () => {
    const def: ServiceDef = {
      name: "wake-daemon",
      command: "definitely-not-a-real-binary-xyz", // would error loudly if the gate leaked
      args: [],
      ready: async () => false,
      enabled: () => false,
      readyTimeoutMs: 500,
    }
    const sup = new Supervisor([def])
    await sup.start()

    const s = sup.status()[0]
    expect(s.state).toBe("stopped")
    expect(s.detail).toContain("disabled")
    expect(s.pid).toBeUndefined()
    expect(s.restarts).toBe(0)
  })

  test("disabled + something already listening (no port to kill) → honest 'STILL listening' detail, never adopted", async () => {
    // A stale daemon from a prior session answers the health probe. With no `port`
    // declared we cannot kill it — the supervisor must NOT adopt it (that would bless
    // the hot mic) and must say plainly that something is still listening.
    const def: ServiceDef = {
      name: "wake-daemon",
      command: "unused",
      args: [],
      ready: async () => true,
      enabled: () => false,
    }
    const sup = new Supervisor([def])
    await sup.start()

    const s = sup.status()[0]
    expect(s.state).toBe("stopped")
    expect(s.detail).toContain("STILL listening")
  })

  test("startService honors the gate: no-op while disabled, real start attempt once enabled", async () => {
    let on = false
    const def: ServiceDef = {
      name: "wake-daemon",
      command: "definitely-not-a-real-binary-xyz",
      args: [],
      ready: async () => false,
      enabled: () => on,
      readyTimeoutMs: 3000,
      autoRestart: false,
    }
    const sup = new Supervisor([def])
    await sup.start()
    expect(sup.status()[0].state).toBe("stopped")

    await sup.startService("wake-daemon") // still disabled → bring() re-checks the gate
    expect(sup.status()[0].state).toBe("stopped")

    on = true
    await sup.startService("wake-daemon") // gate open → a real spawn is attempted
    // The bogus binary can't spawn — but reaching "failed (could not spawn)" PROVES the
    // gate opened and the spawn path ran (vs the gated path, which never touches spawn).
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && sup.status()[0].state !== "failed") {
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(sup.status()[0].state).toBe("failed")
    expect(sup.status()[0].detail).toContain("could not spawn")
  })

  test("stopService KILLS a running child — 'stopped', not muted/alive", async () => {
    // A real long-lived child (node keeping an interval alive). ready() stays false so
    // the service parks in "unhealthy" after its short readiness window — the child is
    // genuinely running either way, which is what stopService must end.
    const def: ServiceDef = {
      name: "wake-daemon",
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      ready: async () => false,
      enabled: () => true,
      readyTimeoutMs: 300,
      autoRestart: false,
    }
    const sup = new Supervisor([def])
    await sup.start()
    const running = sup.status()[0]
    expect(running.pid).toBeGreaterThan(0) // it really spawned

    await sup.stopService("wake-daemon")
    const s = sup.status()[0]
    expect(s.state).toBe("stopped")
    // The child's PID must no longer be alive (signal 0 probes without killing).
    let alive = true
    try {
      process.kill(running.pid!, 0)
    } catch {
      alive = false
    }
    expect(alive).toBe(false)
  }, 20000)

  test("startService stops a STALE listener first — enable means OUR process under the CURRENT env, not a stale adopt", async () => {
    // Bugbot (PR #151): bring() would ADOPT a stale daemon still answering the port —
    // spawned pre-consent with stale env. Enable must kill it and spawn fresh.
    const PORT = 18766
    const stale = spawn(
      process.execPath,
      ["-e", `require('net').createServer(() => {}).listen(${PORT}, '127.0.0.1'); setInterval(() => {}, 1000)`],
      { stdio: "ignore" },
    )
    try {
      const up = Date.now() + 5000
      while (Date.now() < up && !(await tcpProbe(PORT))) await new Promise((r) => setTimeout(r, 100))
      expect(await tcpProbe(PORT)).toBe(true) // stale listener is really up

      const def: ServiceDef = {
        name: "wake-daemon",
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"], // our fresh process (never listens)
        ready: () => tcpProbe(PORT),
        enabled: () => true,
        port: PORT,
        readyTimeoutMs: 300,
        autoRestart: false,
      }
      const sup = new Supervisor([def])
      await sup.startService("wake-daemon")

      const s = sup.status()[0]
      expect(s.pid).toBeGreaterThan(0) // a FRESH child was spawned...
      expect(s.pid).not.toBe(stale.pid) // ...not the stale one adopted
      let staleAlive = true
      try {
        process.kill(stale.pid!, 0)
      } catch {
        staleAlive = false
      }
      expect(staleAlive).toBe(false) // and the stale listener is dead
      await sup.stopService("wake-daemon")
    } finally {
      try {
        stale.kill("SIGKILL")
      } catch {
        /* already gone — the assertion above wants exactly this */
      }
    }
  }, 30000)

  test("a disable that lands while running is honored at the spawn choke point (no respawn)", async () => {
    // Crash-restart path: the child exits on its own while the gate has flipped off —
    // the scheduled respawn must land in "stopped", not bring the mic back.
    let on = true
    const def: ServiceDef = {
      name: "wake-daemon",
      command: process.execPath,
      args: ["-e", "process.exit(1)"], // exits immediately → crash-restart backoff
      ready: async () => false,
      enabled: () => on,
      readyTimeoutMs: 300,
      autoRestart: true,
      maxRestarts: 5,
    }
    const sup = new Supervisor([def])
    await sup.start()
    on = false // user disabled voice while the backoff timer was pending
    const deadline = Date.now() + 6000
    while (Date.now() < deadline && sup.status()[0].state !== "stopped") {
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(sup.status()[0].state).toBe("stopped")
    expect(sup.status()[0].detail).toContain("disabled")
  }, 15000)
})
