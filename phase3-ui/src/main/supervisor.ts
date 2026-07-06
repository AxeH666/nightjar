// Nightjar process supervisor — launches and keeps alive the local sidecars the
// app depends on (llama-server, inference proxy, `opencode serve`, side-channel).
// Pure Node (no Electron import) so it's unit-testable headlessly; the Electron
// main process imports it. Features: dependency-ordered start, adopt-if-already-
// healthy (don't double-spawn), readiness gating, restart-on-crash with backoff,
// periodic health checks, and clean process-group shutdown.
import { spawn, type ChildProcess } from "node:child_process"

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
    m.status.pid = m.child?.pid
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
      this.set(m, "adopted", "already running — adopted, not spawned")
      this.beginHealthWatch(m)
      return
    }
    await this.spawn(m)
  }

  private async spawn(m: Managed): Promise<void> {
    m.intentionalStop = false
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
        setTimeout(() => this.spawn(m).catch(() => {}), backoff)
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
  // path can't race our respawn, then waits for the port to free.
  async restartService(name: string, env?: Record<string, string>): Promise<void> {
    const m = this.managed.find((x) => x.def.name === name)
    if (!m) return
    if (env) m.def.env = env
    if (m.healthTimer) {
      clearInterval(m.healthTimer)
      m.healthTimer = undefined
    }
    const c = m.child
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
    await sleep(1000) // let the port free before re-binding
    m.status.restarts = 0
    await this.spawn(m)
  }

  async stop(): Promise<void> {
    for (const m of this.managed) {
      m.intentionalStop = true
      if (m.healthTimer) clearInterval(m.healthTimer)
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
