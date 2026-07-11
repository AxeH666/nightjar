// Headless regression test for Supervisor.restartService() — no real sidecars.
// Covers the two BYOK-restart cases flagged in review:
//   • ADOPTED service (we hold no PID because bring() adopted a process already
//     on the port): restartService must NOT spawn a colliding second process; it
//     must surface an "adopted / can't apply" state instead of silently letting
//     the stale process shadow the new env.
//   • OWNED service (we spawned it): restartService must kill + respawn with the
//     new env overlay, yielding a fresh PID.
// Run: bun test-supervisor-restart.ts
import { Supervisor, type ServiceDef } from "./src/main/supervisor"

let pass = 0,
  fail = 0
const check = (n: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${n}${extra ? " — " + extra : ""}`)
  ok ? pass++ : fail++
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ADOPTED: ready() is already true at start → the supervisor adopts (never spawns)
// and holds no child/PID. A restart to apply a new BYOK key must not collide.
async function testAdopted() {
  const def: ServiceDef = { name: "svc", command: "sleep", args: ["3600"], ready: async () => true, readyTimeoutMs: 3000 }
  const sup = new Supervisor([def])
  await sup.start()
  let s = sup.status()[0]
  check("adopted at start (not spawned)", s.state === "adopted" && s.pid === undefined, `state=${s.state} pid=${s.pid}`)

  await sup.restartService("svc", { NIGHTJAR_BYOK_OPENAI: "sk-test" })
  s = sup.status()[0]
  check("adopted restart did NOT spawn a colliding process", s.pid === undefined, `pid=${s.pid}`)
  check(
    "adopted restart surfaced the can't-apply state",
    s.state === "adopted" && (s.detail ?? "").includes("unmanaged"),
    `state=${s.state} detail=${s.detail}`,
  )
  await sup.stop()
}

// OWNED: ready() starts false so the supervisor spawns; we flip it true so the
// readiness gate passes. restartService should kill our child and respawn a new
// one carrying the new env.
async function testOwned() {
  let up = false
  const def: ServiceDef = { name: "svc", command: "sleep", args: ["3600"], ready: async () => up, readyTimeoutMs: 5000 }
  const sup = new Supervisor([def])
  setTimeout(() => (up = true), 400) // new process "comes up" shortly after spawn
  await sup.start()
  let s = sup.status()[0]
  const pid1 = s.pid
  check("owned service spawned & healthy", s.state === "healthy" && !!pid1, `state=${s.state} pid=${pid1}`)

  up = false // port frees when we kill our child…
  setTimeout(() => (up = true), 500) // …then the respawned process comes up
  await sup.restartService("svc", { NIGHTJAR_BYOK_OPENAI: "sk-test" })
  s = sup.status()[0]
  check("owned restart respawned with a NEW pid", s.state === "healthy" && !!s.pid && s.pid !== pid1, `state=${s.state} pid=${s.pid} (was ${pid1})`)
  check("owned restart applied the new env overlay", def.env?.NIGHTJAR_BYOK_OPENAI === "sk-test")
  await sup.stop()
}

// COALESCING (race fix): concurrent restartService() calls for the SAME service must
// NOT interleave — that double-spawned / corrupted supervisor state (call A kills the
// child and nulls m.child; call B then mis-reads the adopted branch and both spawn).
// Now reachable because byok:set/remove AND capabilities:set (browser/research/vision)
// all restart opencode-serve and the UI never serializes them. The guard shares one
// in-flight pass and, if requests land mid-pass, runs exactly ONE more with the latest
// env. We stub the private restartOnce to observe overlap deterministically.
async function testCoalesce() {
  const def: ServiceDef = { name: "svc", command: "sleep", args: ["3600"], ready: async () => true, readyTimeoutMs: 3000 }
  const sup = new Supervisor([def])
  let active = 0,
    maxActive = 0,
    calls = 0
  // Replace the real (spawning) pass with an observable stub — restartService looks it
  // up via `this.restartOnce`, so an instance override is picked up.
  ;(sup as unknown as { restartOnce: (m: unknown) => Promise<void> }).restartOnce = async () => {
    calls++
    active++
    maxActive = Math.max(maxActive, active)
    await sleep(150)
    active--
  }
  // 5 concurrent restarts, as a BYOK save + several capability toggles would issue.
  await Promise.all(Array.from({ length: 5 }, (_, i) => sup.restartService("svc", { NIGHTJAR_BYOK_OPENAI: "k" + i })))
  check("coalesced: restartOnce never ran concurrently", maxActive === 1, `maxActive=${maxActive}`)
  check("coalesced: 5 concurrent calls → exactly 2 passes (1 running + 1 coalesced)", calls === 2, `calls=${calls}`)
  check("coalesced: latest env wins", def.env?.NIGHTJAR_BYOK_OPENAI === "k4", `env=${def.env?.NIGHTJAR_BYOK_OPENAI}`)
}

async function main() {
  console.log("→ adopted-restart case…")
  await testAdopted()
  console.log("→ owned-restart case…")
  await testOwned()
  console.log("→ concurrent-restart coalescing…")
  await testCoalesce()
  await sleep(200)
  console.log(`\n==== restartService: ${pass} passed, ${fail} failed ====`)
  process.exit(fail > 0 ? 1 : 0)
}
main().catch((e) => {
  console.error("test error:", e)
  process.exit(1)
})
