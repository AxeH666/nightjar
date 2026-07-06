#!/usr/bin/env bun
// Nightjar run supervisor / watchdog.
//
// Fixes the rare pre-request FREEZE: sometimes (observed only under near-full
// system memory) OpenCode hangs during session setup — before it ever calls the
// model — and never recovers on its own. The generation timeout proxy can't help
// (no request is sent to abort) and an in-process plugin can't help (the process
// itself is wedged). So this external supervisor watches whether the run actually
// reaches the model within a deadline; if it doesn't, it kills the frozen attempt
// and relaunches automatically — the user does nothing and never sees the freeze.
//
// "Progress" = a real generation request reached the inference proxy (the exact
// thing that fails during the freeze). Once a run reaches the model, the proxy's
// own wall-clock timeout guards the generation itself; the watchdog steps back.
//
// Usage:  bun nightjar-run.mjs run "your prompt" --model llamacpp/qwen3-4b-instruct-2507 --auto
// Env:
//   NIGHTJAR_PROXY_URL              (default http://127.0.0.1:8086)
//   NIGHTJAR_FIRST_TOKEN_TIMEOUT_MS (default 45000) — progress deadline per attempt
//   NIGHTJAR_RUN_MAX_ATTEMPTS       (default 3)
//   NIGHTJAR_ENGINE_CMD             (default: bun run --conditions=browser <opencode index.ts>)
//                                   space-separated; run args are appended.

import { spawn } from "node:child_process"

const PROXY = process.env.NIGHTJAR_PROXY_URL || "http://127.0.0.1:8086"
const DEADLINE_MS = Number(process.env.NIGHTJAR_FIRST_TOKEN_TIMEOUT_MS || 45000)
const MAX_ATTEMPTS = Number(process.env.NIGHTJAR_RUN_MAX_ATTEMPTS || 3)
const DEFAULT_ENGINE =
  "bun run --conditions=browser /home/axehe/nightjar/research/opencode/packages/opencode/src/index.ts"
const ENGINE_CMD = (process.env.NIGHTJAR_ENGINE_CMD || DEFAULT_ENGINE).split(/\s+/).filter(Boolean)
const RUN_ARGS = process.argv.slice(2)

const log = (m) => console.error(`[nightjar-watchdog] ${m}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function proxyGenCount() {
  try {
    const r = await fetch(`${PROXY}/nightjar/stats`, { signal: AbortSignal.timeout(2000) })
    if (!r.ok) return null
    return (await r.json()).genRequests ?? null
  } catch {
    return null
  }
}

function killTree(child) {
  // child is a process-group leader (detached); kill the whole group.
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch {}
  try {
    child.kill("SIGKILL")
  } catch {}
}

async function attempt(n) {
  const baseline = (await proxyGenCount()) ?? 0
  log(`attempt ${n}/${MAX_ATTEMPTS} — launching engine (progress deadline ${DEADLINE_MS}ms)`)

  const [cmd, ...cmdArgs] = ENGINE_CMD
  const child = spawn(cmd, [...cmdArgs, ...RUN_ARGS], {
    stdio: ["inherit", "inherit", "inherit"], // user sees the real output
    detached: true, // own process group so a freeze can be killed cleanly
    env: process.env,
  })

  let done = false
  let exitCode = null
  const exitP = new Promise((resolve) =>
    child.on("exit", (code) => {
      done = true
      exitCode = code ?? 0
      resolve()
    }),
  )

  // Poll for progress until the deadline or the child exits.
  const start = Date.now()
  let progressed = false
  while (!done && Date.now() - start < DEADLINE_MS) {
    const cur = await proxyGenCount()
    if (cur !== null && cur > baseline) {
      progressed = true
      break
    }
    await sleep(500)
  }

  if (progressed) {
    log(`progress detected (engine reached the model) — handing off; proxy now guards generation`)
    await exitP
    return { outcome: "done", code: exitCode }
  }

  if (done) {
    // Exited before reaching the model.
    if (exitCode === 0) return { outcome: "done", code: 0 } // trivial/fast success
    log(`engine exited early (code ${exitCode}) without reaching the model — will retry`)
    return { outcome: "retry" }
  }

  // Still running, no progress → frozen in setup. Kill and retry.
  log(`FROZE: no model request after ${DEADLINE_MS}ms — killing attempt and restarting automatically`)
  killTree(child)
  await Promise.race([exitP, sleep(3000)])
  return { outcome: "retry" }
}

for (let n = 1; n <= MAX_ATTEMPTS; n++) {
  const res = await attempt(n)
  if (res.outcome === "done") {
    if (n > 1) log(`recovered on attempt ${n} (the earlier freeze was auto-restarted; user saw no error)`)
    process.exit(res.code ?? 0)
  }
}

log(
  `all ${MAX_ATTEMPTS} attempts froze before reaching the model. The engine appears stuck — ` +
    `this is almost always low memory. Close other apps and try again.`,
)
process.exit(1)
