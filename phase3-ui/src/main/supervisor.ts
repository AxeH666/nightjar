// Nightjar process supervisor — launches and keeps alive the local sidecars the
// app depends on (llama-server, inference proxy, `opencode serve`, side-channel).
// Pure Node (no Electron import) so it's unit-testable headlessly; the Electron
// main process imports it. Features: dependency-ordered start, adopt-if-already-
// healthy (don't double-spawn), readiness gating, restart-on-crash with backoff,
// periodic health checks, and clean process-group shutdown.
import { spawn, execFile, type ChildProcess } from "node:child_process"
import { promisify } from "node:util"

const execFileP = promisify(execFile)

// Best-effort cross-platform "which PID is LISTENing on this local TCP port". Hard
// 2s wall-clock cap (rule 3) so a blocked probe can never wedge a restart. Returns a
// PID ONLY when EXACTLY ONE distinct listener is found — zero, or ambiguous (>1, as
// `fuser` can emit) → undefined, and we never guess a kill target (rule-4 analogue).
export async function pidOnPort(port: number): Promise<number | undefined> {
  const opts = { timeout: 2000, windowsHide: true } as const
  const run = async (cmd: string, args: string[]): Promise<string> => {
    try {
      const { stdout } = await execFileP(cmd, args, opts)
      return stdout || ""
    } catch (e: any) {
      return (e?.stdout as string) || "" // some tools exit non-zero on no-match; keep partial stdout
    }
  }
  const pids = new Set<number>()
  const addAll = (out: string, re: RegExp) => {
    for (const m of out.matchAll(re)) {
      const n = Number(m[1])
      if (Number.isInteger(n) && n > 0) pids.add(n)
    }
  }
  if (process.platform === "win32") {
    // rows: TCP  0.0.0.0:4096  0.0.0.0:0  LISTENING  1234
    for (const line of (await run("netstat", ["-ano"])).split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/)
      const local = cols[1] || ""
      if (/LISTENING/i.test(line) && local.endsWith(`:${port}`)) {
        const n = Number(cols[cols.length - 1])
        if (Number.isInteger(n) && n > 0) pids.add(n)
      }
    }
  } else if (process.platform === "darwin") {
    addAll(await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]), /(\d+)/g)
  } else {
    // linux: ss (modern), then lsof, then fuser (fuser can emit multiple pids).
    for (const line of (await run("ss", ["-ltnpH"])).split(/\r?\n/)) {
      const local = line.trim().split(/\s+/)[3] || "" // State Recv-Q Send-Q Local:Port Peer:Port Process
      if (local.endsWith(`:${port}`)) addAll(line, /pid=(\d+)/g)
    }
    if (pids.size === 0) addAll(await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]), /(\d+)/g)
    if (pids.size === 0) addAll(await run("fuser", [`${port}/tcp`]), /(\d+)/g)
  }
  return pids.size === 1 ? [...pids][0] : undefined
}

export type ServiceState =
  | "pending" | "starting" | "healthy" | "unhealthy" | "restarting" | "stopped" | "failed" | "adopted"

export interface ServiceDef {
  name: string
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  ready: () => Promise<boolean> // health probe
  readyTimeoutMs?: number // wait this long for first healthy after spawn (default 90s)
  autoRestart?: boolean // default true
  maxRestarts?: number // default 5
  port?: number // the TCP port this service LISTENs on — enables PID capture on ADOPT (NJ-5)
}

export interface ServiceStatus {
  name: string
  state: ServiceState
  pid?: number
  restarts: number
  detail?: string
}

interface Managed {
  def: ServiceDef
  child?: ChildProcess
  status: ServiceStatus
  logs: string[]
  intentionalStop: boolean
  healthTimer?: NodeJS.Timeout
  restartTimer?: NodeJS.Timeout // pending crash-restart backoff; tracked so stop()/restartService can cancel it
  adoptedPid?: number // PID of an ADOPTED (not-spawned-by-us) process, so restartService can stop it (NJ-5)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function httpOk(url: string, matcher?: (body: string) => boolean, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return false
    if (!matcher) return true
    return matcher(await res.text())
  } catch {
    return false
  }
}

export class Supervisor {
  private managed: Managed[]
  constructor(
    services: ServiceDef[],
    private onChange?: (statuses: ServiceStatus[]) => void,
  ) {
    this.managed = services.map((def) => ({
      def,
      status: { name: def.name, state: "pending", restarts: 0 },
      logs: [],
      intentionalStop: false,
    }))
  }

  status(): ServiceStatus[] {
    return this.managed.map((m) => ({ ...m.status }))
  }
  private emit() {
    this.onChange?.(this.status())
  }
  private set(m: Managed, state: ServiceState, detail?: string) {
    m.status.state = state
    m.status.detail = detail
    m.status.pid = m.child?.pid ?? m.adoptedPid // show the adopted PID too (NJ-5)
    this.emit()
  }

  // Start every service (in array order = dependency order). Resolves once all
  // are healthy/adopted or have failed their readiness window.
  async start(): Promise<void> {
    for (const m of this.managed) await this.bring(m)
  }

  private async bring(m: Managed): Promise<void> {
    // adopt if something is already answering the health probe on that port
    if (await m.def.ready()) {
      // NJ-5: capture the adopted process's PID (via its declared port) so a later
      // restartService (e.g. a BYOK key change) can stop + re-exec it under the new
      // env — instead of bailing because we have no handle on it.
      if (m.def.port) m.adoptedPid = await pidOnPort(m.def.port)
      this.set(m, "adopted", "already running — adopted, not spawned")
      this.beginHealthWatch(m)
      return
    }
    await this.spawn(m)
  }

  private async spawn(m: Managed): Promise<void> {
    m.intentionalStop = false
    m.adoptedPid = undefined // we're spawning our OWN process now — no longer adopting
    this.set(m, "starting")
    const child = spawn(m.def.command, m.def.args, {
      cwd: m.def.cwd,
      env: { ...process.env, ...(m.def.env ?? {}) },
      detached: true, // own process group → clean tree kill
      stdio: ["ignore", "pipe", "pipe"],
    })
    m.child = child
    const cap = (b: Buffer) => {
      m.logs.push(b.toString())
      if (m.logs.length > 200) m.logs.shift()
    }
    child.stdout?.on("data", cap)
    child.stderr?.on("data", cap)

    child.on("exit", (code) => {
      m.child = undefined
      if (m.intentionalStop) {
        this.set(m, "stopped")
        return
      }
      // unexpected exit → restart with backoff
      if ((m.def.autoRestart ?? true) && m.status.restarts < (m.def.maxRestarts ?? 5)) {
        m.status.restarts++
        this.set(m, "restarting", `exited (code ${code}); restart ${m.status.restarts}`)
        const backoff = Math.min(15000, 1000 * 2 ** (m.status.restarts - 1))
        m.restartTimer = setTimeout(() => {
          m.restartTimer = undefined
          if (m.intentionalStop) return // stop() landed between scheduling and firing → do not respawn
          this.spawn(m).catch(() => {})
        }, backoff)
      } else {
        this.set(m, "failed", `exited (code ${code}); restarts exhausted`)
      }
    })

    // gate on readiness
    const deadline = Date.now() + (m.def.readyTimeoutMs ?? 90000)
    while (Date.now() < deadline) {
      if (!m.child) return // exited during startup; exit handler owns state
      if (await m.def.ready()) {
        this.set(m, "healthy")
        this.beginHealthWatch(m)
        return
      }
      await sleep(1000)
    }
    this.set(m, "unhealthy", "did not become healthy within timeout")
  }

  // Periodic liveness probe; a healthy service that fails repeatedly is restarted.
  private beginHealthWatch(m: Managed) {
    if (m.healthTimer) clearInterval(m.healthTimer)
    let misses = 0
    m.healthTimer = setInterval(async () => {
      if (m.intentionalStop) return
      const ok = await m.def.ready()
      if (ok) {
        misses = 0
        if (m.status.state === "unhealthy") this.set(m, m.child ? "healthy" : "adopted")
      } else {
        misses++
        if (misses >= 3) {
          this.set(m, "unhealthy", "failed 3 consecutive health checks")
          if (m.child && (m.def.autoRestart ?? true)) {
            try {
              process.kill(-m.child.pid!, "SIGKILL")
            } catch {}
            // exit handler triggers the restart
          }
        }
      }
    }, 5000)
  }

  // Replace a service's env overlay (used before start to inject BYOK keys).
  setEnv(name: string, env: Record<string, string>): void {
    const m = this.managed.find((x) => x.def.name === name)
    if (m) m.def.env = env
  }

  // Cleanly restart one service, optionally with a fresh env overlay (BYOK key
  // add/remove). Removes the old child's exit listener first so the crash-restart
  // path can't race our respawn, then waits for the port to free before rebinding.
  //
  // ADOPTED services are the tricky case: `bring()` adopts a process already
  // answering the port WITHOUT spawning it, so we hold no `m.child`/PID and CANNOT
  // stop it. Blindly spawning here would bind-conflict with (and be shadowed by)
  // that still-running stale process, so the new env (e.g. a BYOK key) would never
  // take effect — silently. We detect that and surface it instead of colliding.
  async restartService(name: string, env?: Record<string, string>): Promise<void> {
    const m = this.managed.find((x) => x.def.name === name)
    if (!m) return
    if (env) m.def.env = env
    if (m.healthTimer) {
      clearInterval(m.healthTimer)
      m.healthTimer = undefined
    }
    // Cancel any pending crash-restart backoff so it can't double-spawn during the restart.
    if (m.restartTimer) {
      clearTimeout(m.restartTimer)
      m.restartTimer = undefined
    }
    const c = m.child
    const owned = Boolean(c) // did WE spawn it? (adopted processes have no child)
    if (c) {
      m.intentionalStop = true
      c.removeAllListeners("exit")
      if (c.pid) {
        try {
          process.kill(-c.pid, "SIGKILL")
        } catch {}
      }
      m.child = undefined
    }
    if (owned) {
      // We killed our own child — wait for its port to actually release before
      // rebinding (poll rather than a fixed sleep; exits as soon as it's free).
      const freeBy = Date.now() + 6000
      while (Date.now() < freeBy && (await m.def.ready())) await sleep(300)
    } else if (await m.def.ready()) {
      // Adopted/unmanaged process still holds the port. NJ-5: stop it (SIGTERM →
      // SIGKILL), wait for the port to free, then spawn our own under the new env.
      // Re-query the CURRENT listener NOW rather than trusting the adopt-time PID —
      // the adopted process may have been externally restarted (new PID) since adopt,
      // and a stale PID could ESRCH or, if recycled, signal an innocent process (rule
      // 4). pidOnPort returns undefined on 0/ambiguous, so we never guess a target.
      // NOTE (rule 7): we signal ONLY the single main PID, never a `-group` we didn't
      // create — so an adopted opencode-serve's MCP CHILDREN can be left orphaned when
      // its parent dies (they're re-created by our fresh spawn). Group-killing an
      // unowned session would be the more dangerous rule-4 violation; this is the
      // documented tradeoff (see KNOWN_ISSUES NJ-5).
      const pid = m.def.port ? await pidOnPort(m.def.port) : undefined
      if (!pid) {
        this.set(
          m,
          "adopted",
          "cannot apply change: opencode-serve is running unmanaged (adopted) and still holds its port — " +
            "restart June (or stop that process) to pick up the API-key change",
        )
        this.beginHealthWatch(m)
        return
      }
      try {
        process.kill(pid, "SIGTERM")
      } catch {}
      let freeBy = Date.now() + 4000
      while (Date.now() < freeBy && (await m.def.ready())) await sleep(300)
      if (await m.def.ready()) {
        try {
          process.kill(pid, "SIGKILL")
        } catch {}
        freeBy = Date.now() + 4000
        while (Date.now() < freeBy && (await m.def.ready())) await sleep(300)
      }
      m.adoptedPid = undefined
      if (await m.def.ready()) {
        // Still held (our kill didn't free it — wrong PID, or a peer respawned it) →
        // don't collide; surface honestly.
        this.set(
          m,
          "adopted",
          `cannot apply change: the adopted process on port ${m.def.port} didn't release it — ` +
            "restart June (or stop that process) to pick up the API-key change",
        )
        this.beginHealthWatch(m)
        return
      }
      // Port freed → fall through to spawn our own under the new env.
    }
    m.status.restarts = 0
    await this.spawn(m)
  }

  async stop(): Promise<void> {
    for (const m of this.managed) {
      m.intentionalStop = true
      if (m.healthTimer) clearInterval(m.healthTimer)
      if (m.restartTimer) {
        clearTimeout(m.restartTimer)
        m.restartTimer = undefined
      }
      const c = m.child
      if (!c?.pid) {
        this.set(m, "stopped")
        continue
      }
      try {
        process.kill(-c.pid, "SIGTERM")
      } catch {}
    }
    // grace, then hard-kill survivors
    await sleep(2500)
    for (const m of this.managed) {
      const c = m.child
      if (c?.pid) {
        try {
          process.kill(-c.pid, "SIGKILL")
        } catch {}
      }
      this.set(m, "stopped")
    }
  }

  logs(name: string): string[] {
    return this.managed.find((m) => m.def.name === name)?.logs ?? []
  }
}
