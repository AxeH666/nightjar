import { useEffect, useState } from "react"

// Local reminder-scheduler availability (P2-20). The free tier fires desktop notifications
// for due tasks ONLY while the app is open, and only when the odysseus venv + OS notifications
// are present. NJ-16 makes task_create return success regardless, so without this banner a user
// is told "reminder set" while nothing ever fires. Renders nothing when reminders can fire.
type SchedulerStatus =
  | { available: true }
  | { available: false; reason: "setup" | "notifications" }

interface SchedulerBridge {
  getSchedulerStatus(): Promise<SchedulerStatus>
  onSchedulerStatus(cb: (s: SchedulerStatus) => void): () => void
}
function bridge(): SchedulerBridge | null {
  return (window as unknown as { nightjar?: SchedulerBridge }).nightjar ?? null
}

const BAR =
  "flex items-center gap-3 border-b border-nightjar-surface/70 bg-nightjar-surface/40 px-4 py-1.5 text-xs text-nightjar-text/70"

export function SchedulerBanner() {
  const [st, setSt] = useState<SchedulerStatus | null>(null)
  useEffect(() => {
    const b = bridge()
    if (!b) return
    b.getSchedulerStatus?.().then(setSt).catch(() => {})
    return b.onSchedulerStatus?.(setSt)
  }, [])

  if (!st || st.available) return null // ready (or unknown) → silent

  const msg =
    st.reason === "notifications"
      ? "⏰ Offline reminders can't fire — this system has no desktop notifications. Any reminders you create won't alert you here."
      : "⏰ Offline reminders aren't set up yet — finish setup (the reminder engine isn't installed), or they won't fire while the app is open."
  return (
    <div className={BAR} role="status">
      <span>{msg}</span>
    </div>
  )
}
