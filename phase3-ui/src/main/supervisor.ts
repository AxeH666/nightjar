// Nightjar process supervisor — launches and keeps alive the local sidecars the
// app depends on (llama-server, inference proxy, `opencode serve`, side-channel).
// Pure Node (no Electron import) so it's unit-testable headlessly; the Electron
// main process imports it. Features: dependency-ordered start, adopt-if-already-
// healthy (don't double-spawn), readiness gating, restart-on-crash with backoff,
// periodic health checks, and clean process-group shutdown.
import { spawn, execFile, type ChildProcess } from "node:child_process"
import { promisify } from "node:util"

const execFileP = promisify(execFile)

// Cross-platform process termination. On POSIX we spawn children `detached` (their own
// process group) and kill the GROUP via a negative pid; Windows has no process groups, so
// `taskkill /T` walks the tree. killTree = the whole tree (our OWN detached children);
// killProc = a single process (an ADOPTED unmanaged process we must NOT group-kill — mirrors
// the POSIX single-pid signal, NJ-5). force=false → graceful (SIGTERM / taskkill), true →
// hard (SIGKILL / taskkill /F). Best-effort: a target that's already gone is ignored.
function killTree(pid: number, force: boolean): void {
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])], { windowsHide: true }, () => {})
  } else {
    try {
      process.kill(-pid, force ? "SIGKILL" : "SIGTERM")
    } catch {}
  }
}
function killProc(pid: number, force: boolean): void {
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(pid), ...(force ? ["/F"] : [])], { windowsHide: true }, () => {})
  } else {
    try {
      process.kill(pid, force ? "SIGKILL" : "SIGTERM")
    } catch {}
  }
}

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
      // Match the local address:port column by its `:<port>` SUFFIX rather than a
      // fixed index — ss prints a leading Netid column in some iproute2 versions, so
      // the address isn't always at the same position. For -l (listening) output the
      // peer column is always `*`-suffixed, so the only token ending in `:<port>` is
      // the local listen address; endsWith requires the colon so `:496` can't match `:96`.
      const cols = line.trim().split(/\s+/)
      if (cols.some((c) => c.endsWith(`:${port}`))) addAll(line, /pid=(\d+)/g)
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
  // Synchronous gate run right before SPAWN (never before ADOPT): return a human-readable
  // reason to mark the service `failed` immediately instead of spawning something that
  // cannot possibly work — e.g. a required source/binary is absent. Returns null when OK.
  // Without this, spawning a missing target (bun against an absent engine entry) exits
  // nonzero and burns the whole restart budget into an opaque "restarts exhausted"
  // (audit1.md P0-2).
  preflight?: () => string | null
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
  restartInFlight?: Promise<void> // single-flight guard: one restart pass at a time per service
  restartPending?: boolean // a restart was requested mid-pass → run exactly one more with the latest env
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
    // Preflight (audit1.md P0-2): if the service reports it can't start (its source/binary
    // is absent), fail fast with an actionable message instead of spawning a target that
    // just exits nonzero and drains the restart budget. Adoption is unaffected — bring()
    // checks ready() before ever calling spawn(), so an already-running instance is still
    // adopted regardless of preflight. This is the single choke point for every spawn
    // (initial + crash-restart), so a missing target can never enter a restart loop.
    const pf = m.def.preflight?.()
    if (pf) {
      this.set(m, "failed", pf)
      return
    }
    m.intentionalStop = false
    m.adoptedPid = undefined // we're spawning our OWN process now — no longer adopting
    this.set(m, "starting")
    const child = spawn(m.def.command, m.def.args, {
      cwd: m.def.cwd,
      env: { ...process.env, ...(m.def.env ?? {}) },
      detached: true, // own process group → clean tree kill (POSIX); taskkill /T on Windows
      windowsHide: true, // no console-window pop-ups for the spawned sidecars on Windows
      stdio: ["ignore", "pipe", "pipe"],
    })
    m.child = child
    const cap = (b: Buffer) => {
      m.logs.push(b.toString())
      if (m.logs.length > 200) m.logs.shift()
    }
    child.stdout?.on("data", cap)
    child.stderr?.on("data", cap)

    // A spawn failure (most often ENOENT — a legitimately-absent optional binary such as
    // llama-server when running on BYOK cloud, or a missing bun on a fresh box) emits 'error'.
    // With no listener that would crash the app on an unhandled 'error'. Capture it and drop
    // m.child so the readiness gate below returns immediately (no long foreground wait) and the
    // service is marked failed — the app then continues bringing up the rest (opencode-serve, …).
    child.on("error", (err) => {
      cap(Buffer.from(`spawn error: ${(err as Error)?.message ?? String(err)}\n`))
      if (m.child === child) {
        m.child = undefined
        this.set(m, "failed", `could not spawn: ${(err as Error)?.message ?? String(err)}`)
      }
    })

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
    // NJ-12: a service can miss its readiness window yet still be legitimately
    // loading — diffusion-server's ~6GB cold GPU load can exceed readyTimeoutMs on a
    // contended/cold GPU. Without a probe here it stays "unhealthy" forever even once
    // it actually starts serving, silently defeating anything gated on its health (the
    // NJ-6 local-first image reconcile keys on the diffusion-server healthy transition,
    // so image gen would stay pinned to cloud while a working local model is up). Start
    // a PASSIVE recovery probe that only flips unhealthy→healthy once it finally
    // answers. It deliberately does NOT kill/restart on continued misses (unlike
    // beginHealthWatch): the process is alive and may just need more time, and killing
    // it would restart the slow load from scratch — a doom loop. Rule 3 still holds: the
    // child has its own wall-clock --timeout, and its 'exit' owns the crash-restart.
    this.beginRecoveryWatch(m)
  }

  // NJ-12: passive recovery probe for a service that missed its readiness window but is
  // still alive (slow cold load). Flips it to healthy once it answers, then hands off to
  // beginHealthWatch. NEVER kills the child (the crash-restart path, driven by the child
  // 'exit' event, owns that) so it cannot doom-loop a slow loader. Uses the shared
  // healthTimer slot so stop()/restartService cancel it too. Self-cancels once the
  // service leaves "unhealthy", the child exits, or a stop lands — and re-checks those
  // guards AFTER the await so a restart/stop that landed mid-probe is not clobbered.
  private beginRecoveryWatch(m: Managed) {
    if (m.healthTimer) clearInterval(m.healthTimer)
    m.healthTimer = setInterval(async () => {
      if (m.intentionalStop || m.status.state !== "unhealthy" || !m.child) {
        if (m.healthTimer) clearInterval(m.healthTimer)
        m.healthTimer = undefined
        return
      }
      if (await m.def.ready()) {
        if (m.intentionalStop || m.status.state !== "unhealthy" || !m.child) return
        this.set(m, "healthy")
        this.beginHealthWatch(m) // hand off to the normal liveness probe (clears this timer first)
      }
    }, 5000)
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
            killTree(m.child.pid!, true)
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
  // Single-flight + coalesced per service. restartOnce() mutates shared per-service
  // state (m.child, m.intentionalStop, m.status, m.def.env) across many await points
  // (port-free polls, SIGTERM waits, spawn), so two concurrent restarts of the SAME
  // service would interleave and corrupt it — call A kills the child and nulls m.child,
  // call B then reads m.child===undefined, mis-takes the adopted branch, and both fall
  // through to spawn() → two processes fighting for the port, a crash-restart storm, or
  // the engine left down. This is now reachable because byok:set/remove AND
  // capabilities:set (browser/research/vision) all restart opencode-serve and the UI
  // never serializes them. Guard it exactly like reconcileImageEndpoint: run passes to
  // completion, and if a newer request lands mid-pass, run ONE more afterward so the
  // latest env still wins.
  async restartService(name: string, env?: Record<string, string>): Promise<void> {
    const m = this.managed.find((x) => x.def.name === name)
    if (!m) return
    if (env) m.def.env = env // record the latest env even when we coalesce onto a running pass
    if (m.restartInFlight) {
      m.restartPending = true
      return m.restartInFlight
    }
    m.restartInFlight = (async () => {
      do {
        m.restartPending = false
        await this.restartOnce(m)
      } while (m.restartPending) // a request arrived mid-pass → restart again with the latest env
    })().finally(() => {
      m.restartInFlight = undefined
    })
    return m.restartInFlight
  }

  private async restartOnce(m: Managed): Promise<void> {
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
        killTree(c.pid, true)
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
      killProc(pid, false)
      let freeBy = Date.now() + 4000
      while (Date.now() < freeBy && (await m.def.ready())) await sleep(300)
      if (await m.def.ready()) {
        // NJ-5 hardening (rule 4): re-query the listener immediately before SIGKILL
        // rather than reusing the pre-SIGTERM PID. If an external supervisor respawned
        // the process during the up-to-4s SIGTERM wait AND the OS recycled the PID, the
        // stale PID could name an innocent process. Only SIGKILL when the port's sole
        // listener is STILL the same PID; otherwise skip — the "didn't release" surface
        // below then reports honestly instead of us killing the wrong target.
        const still = m.def.port ? await pidOnPort(m.def.port) : pid
        if (still === pid) {
          killProc(pid, true)
          freeBy = Date.now() + 4000
          while (Date.now() < freeBy && (await m.def.ready())) await sleep(300)
        }
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
      killTree(c.pid, false)
    }
    // grace, then hard-kill survivors
    await sleep(2500)
    for (const m of this.managed) {
      const c = m.child
      if (c?.pid) {
        killTree(c.pid, true)
      }
      this.set(m, "stopped")
    }
  }

  logs(name: string): string[] {
    return this.managed.find((m) => m.def.name === name)?.logs ?? []
  }
}
