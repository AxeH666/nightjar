import { useRef, useState } from "react"

export interface ServiceStatus {
  name: string
  state: string
  pid?: number
  restarts: number
  detail?: string
}

const DOT: Record<string, string> = {
  healthy: "bg-emerald-500",
  adopted: "bg-nightjar-accent",
  starting: "bg-nightjar-accent animate-pulse",
  restarting: "bg-nightjar-accent animate-pulse",
  pending: "bg-nightjar-text/30",
  unhealthy: "bg-nightjar-alert",
  failed: "bg-nightjar-alert",
  stopped: "bg-nightjar-text/30",
}

// States where a manual restart is a sensible affordance (the supervisor auto-restarts on crash,
// but exhausts its budget → `failed`, or freezes → `unhealthy`).
const RESTARTABLE = new Set(["failed", "unhealthy"])

// audit1.md P2-6/P2-7: the strip used to be display-only, so a red service on a fresh box was an
// opaque dot with a tooltip. Now click a service to see WHY it's red (its captured stdout/stderr)
// and restart it. Turns the "invisible failure" surface into a diagnosable, actionable one.
export function HealthStrip({ services }: { services: ServiceStatus[] }) {
  const [open, setOpen] = useState<string | null>(null)
  const [logs, setLogs] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  // Synchronous mirror of `open` so an out-of-order serviceLogs response for a DIFFERENT service
  // (switched selection, or a restart-triggered refetch) can't overwrite the current one (BugBot).
  const openRef = useRef<string | null>(null)

  if (services.length === 0) return null

  const select = (name: string | null) => {
    openRef.current = name
    setOpen(name)
  }
  const loadLogs = async (name: string) => {
    try {
      const result = (await window.nightjar?.serviceLogs?.(name)) ?? []
      if (openRef.current !== name) return // selection changed mid-fetch → drop the stale result
      setLogs(result)
    } catch {
      if (openRef.current === name) setLogs(["(couldn't read logs)"])
    }
  }
  const toggle = async (name: string) => {
    if (open === name) {
      select(null)
      return
    }
    select(name)
    setLogs([])
    await loadLogs(name)
  }
  const restart = async (name: string) => {
    setBusy(true)
    try {
      await window.nightjar?.restartService?.(name)
    } catch {
      /* the strip will reflect the new state via the status push; logs refresh below */
    } finally {
      setBusy(false)
      await loadLogs(name)
    }
  }

  const openSvc = services.find((s) => s.name === open)

  return (
    <div className="border-b border-nightjar-surface bg-nightjar-surface/40 text-xs">
      <div className="flex items-center gap-3 px-4 py-1">
        <span className="text-nightjar-text/40">services</span>
        {services.map((s) => (
          <button
            key={s.name}
            onClick={() => toggle(s.name)}
            title={`${s.state}${s.detail ? " — " + s.detail : ""}${s.restarts ? ` (restarts: ${s.restarts})` : ""} — click for logs`}
            className={`flex items-center gap-1.5 rounded px-1 hover:bg-nightjar-text/10 ${open === s.name ? "bg-nightjar-text/10" : ""}`}
          >
            <span className={`h-2 w-2 rounded-full ${DOT[s.state] ?? "bg-nightjar-text/30"}`} />
            <span className="text-nightjar-text/70">{s.name}</span>
            {s.restarts > 0 && <span className="text-nightjar-alert/80">↻{s.restarts}</span>}
          </button>
        ))}
      </div>

      {openSvc && (
        <div className="border-t border-nightjar-surface/60 px-4 py-2">
          <div className="mb-1 flex items-center gap-3">
            <span className="text-nightjar-text/60">
              <b className="text-nightjar-text/80">{openSvc.name}</b> —{" "}
              <span className={RESTARTABLE.has(openSvc.state) ? "text-nightjar-alert" : "text-nightjar-text/60"}>{openSvc.state}</span>
              {openSvc.detail ? ` · ${openSvc.detail}` : ""}
            </span>
            {RESTARTABLE.has(openSvc.state) && (
              <button
                onClick={() => restart(openSvc.name)}
                disabled={busy}
                className="rounded border border-nightjar-text/40 px-2 py-0.5 text-[11px] hover:bg-nightjar-text/10 disabled:opacity-40"
              >
                {busy ? "restarting…" : "↻ Restart"}
              </button>
            )}
            <button onClick={() => select(null)} className="ml-auto text-nightjar-text/50 hover:underline">
              close
            </button>
          </div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-nightjar-base/60 p-2 text-[11px] leading-snug text-nightjar-text/70">
            {logs.length ? logs.join("") : "(no logs captured)"}
          </pre>
        </div>
      )}
    </div>
  )
}
