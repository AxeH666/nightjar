// Headless test of the Nightjar process supervisor against the REAL sidecars.
// Exercises: adopt (llama-server already up), spawn (proxy/opencode/side-channel),
// readiness gating, kill→auto-restart, and clean shutdown. Run: bun test-supervisor.ts
// Uses the light phase3-ui/test-workspace for opencode-serve (fast; the full-MCP
// workspace was already validated in Phase 2b).
process.env.NIGHTJAR_WORKSPACE = "/home/axehe/nightjar/phase3-ui/test-workspace"

import { Supervisor } from "./src/main/supervisor"
import { nightjarServices } from "./src/main/services"

let pass = 0, fail = 0
const check = (n: string, ok: boolean, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${n}${extra ? " — " + extra : ""}`); ok ? pass++ : fail++ }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const sup = new Supervisor(nightjarServices())
  const byName = () => Object.fromEntries(sup.status().map((s) => [s.name, s]))

  console.log("→ starting supervisor (adopt llama, spawn proxy/opencode/side-channel)…")
  await sup.start()
  let st = byName()
  console.log("   states:", sup.status().map((s) => `${s.name}=${s.state}`).join(" "))

  check("llama-server adopted (already running, not re-spawned)", st["llama-server"].state === "adopted")
  check("inference-proxy spawned & healthy", st["inference-proxy"].state === "healthy", st["inference-proxy"].detail)
  check("opencode-serve spawned & healthy", st["opencode-serve"].state === "healthy", st["opencode-serve"].detail)
  check("side-channel spawned & healthy", st["side-channel"].state === "healthy", st["side-channel"].detail)

  // ---- kill the supervisor-owned proxy → expect auto-restart ----
  const proxyPid = st["inference-proxy"].pid
  console.log(`→ killing inference-proxy (pid ${proxyPid}) to test auto-restart…`)
  if (proxyPid) { try { process.kill(-proxyPid, "SIGKILL") } catch { try { process.kill(proxyPid, "SIGKILL") } catch {} } }

  // wait for supervisor to notice exit + restart + become healthy again
  let restarted = false
  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    const s = byName()["inference-proxy"]
    if (s.restarts >= 1 && s.state === "healthy") { restarted = true; break }
  }
  st = byName()
  check("inference-proxy auto-restarted after kill", restarted, `restarts=${st["inference-proxy"].restarts} state=${st["inference-proxy"].state}`)
  check("restarted proxy has a NEW pid", !!st["inference-proxy"].pid && st["inference-proxy"].pid !== proxyPid)

  // ---- clean shutdown ----
  console.log("→ shutting down supervisor…")
  await sup.stop()
  await sleep(500)
  // owned services should be down; llama (adopted) should still be up
  const proxyDown = !(await fetch("http://127.0.0.1:8086/health").then((r) => r.ok).catch(() => false))
  const opencodeDown = !(await fetch("http://127.0.0.1:4096/agent").then((r) => r.ok).catch(() => false))
  const llamaUp = await fetch("http://127.0.0.1:8085/health").then((r) => r.ok).catch(() => false)
  check("owned proxy stopped on shutdown", proxyDown)
  check("owned opencode-serve stopped on shutdown", opencodeDown)
  check("adopted llama-server NOT killed by shutdown", llamaUp)

  console.log(`\n==== supervisor: ${pass} passed, ${fail} failed ====`)
  process.exit(fail > 0 ? 1 : 0)
}
main().catch((e) => { console.error("test error:", e); process.exit(1) })
