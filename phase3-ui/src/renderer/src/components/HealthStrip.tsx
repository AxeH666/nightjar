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

export function HealthStrip({ services }: { services: ServiceStatus[] }) {
  if (services.length === 0) return null
  return (
    <div className="flex items-center gap-3 border-b border-nightjar-surface bg-nightjar-surface/40 px-4 py-1 text-xs">
      <span className="text-nightjar-text/40">services</span>
      {services.map((s) => (
        <span key={s.name} className="flex items-center gap-1.5" title={`${s.state}${s.detail ? " — " + s.detail : ""}${s.restarts ? ` (restarts: ${s.restarts})` : ""}`}>
          <span className={`h-2 w-2 rounded-full ${DOT[s.state] ?? "bg-nightjar-text/30"}`} />
          <span className="text-nightjar-text/70">{s.name}</span>
          {s.restarts > 0 && <span className="text-nightjar-alert/80">↻{s.restarts}</span>}
        </span>
      ))}
    </div>
  )
}
