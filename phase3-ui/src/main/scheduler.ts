// Local reminder scheduler (Task 6, free tier). The missing daemon (NJ-17): Nightjar has no
// long-lived host process, so reminders created via task_create never fired. This polls the PIM
// DB on an interval and shows a DESKTOP notification for each due task — the free tier's promise:
// reminders fire ONLY while the app is open. (The paid always-on Telegram server, PR 17, is the
// laptop-closed path.)
//
// The poll runs a short Python one-shot (phase2-odysseus/servers/task_poller.py) that CLAIMS the
// due tasks — marks them fired + advances/completes — and prints them as JSON. So a task fires at
// most once even if two polls overlap, and a missed notification is bounded to one (best-effort,
// which is the honest guarantee for a local-only tier).
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { Notification } from "electron"
import { REPO, venvPython } from "./services"

const POLL_INTERVAL_MS = 60_000 // once a minute — reminders are minute-granular (HH:MM)
const POLL_TIMEOUT_MS = 20_000 // rule 3: a poll subprocess that hangs is killed

let timer: ReturnType<typeof setInterval> | null = null
let initialTimer: ReturnType<typeof setTimeout> | null = null
// The poller CLAIMS due tasks (marks them fired) before we can show a notification, so once
// we've stopped we must not process a late poll result — the task is already advanced in the
// DB and a notification after shutdown is wrong. Guards the in-flight execFile callback.
let stopped = false

function pyPath(): string {
  return venvPython(join(REPO, "phase2-odysseus", "venv"))
}
function pollerScript(): string {
  return join(REPO, "phase2-odysseus", "servers", "task_poller.py")
}

interface DueTask {
  id: string
  name: string
  prompt: string
  schedule: string
}

function runPoll(): void {
  execFile(
    pyPath(),
    [pollerScript()],
    {
      timeout: POLL_TIMEOUT_MS,
      killSignal: "SIGKILL",
      windowsHide: true,
      env: { ...process.env, NIGHTJAR_ROOT: REPO },
    },
    (err, stdout) => {
      if (stopped) return // shutting down — the claimed tasks are already advanced; don't notify
      if (err) {
        // A failed poll is non-fatal — log and try again next interval. Don't spam notifications.
        console.warn("[scheduler] poll failed:", err.message)
        return
      }
      const line = (stdout || "").trim().split("\n").filter(Boolean).pop()
      if (!line) return
      let due: DueTask[] = []
      try {
        const parsed = JSON.parse(line) as { due?: DueTask[]; error?: string }
        if (parsed.error) {
          console.warn("[scheduler] poller error:", parsed.error)
          return
        }
        due = parsed.due ?? []
      } catch {
        console.warn("[scheduler] unparseable poller output:", line.slice(0, 200))
        return
      }
      for (const task of due) {
        new Notification({
          title: task.name || "June reminder",
          body: task.prompt || task.name || "You have a reminder.",
        }).show()
      }
    },
  )
}

// Whether local reminders can actually fire, and if not, why. Surfaced to the renderer so a
// user isn't told "reminder set" (NJ-16 returns success) while it silently never fires (P2-20).
export type SchedulerStatus =
  | { available: true }
  | { available: false; reason: "setup" | "notifications" }

// Cached so the renderer can PULL it on mount — the startup push may land before the window is
// listening (mirrors the vision-status cache). Optimistic default → the banner stays silent
// until startLocalScheduler() runs its (synchronous) checks.
let schedulerStatus: SchedulerStatus = { available: true }
export function getSchedulerStatus(): SchedulerStatus {
  return schedulerStatus
}

// Start the local scheduler. Gated on the odysseus venv existing (mirrors the other sidecar
// gates) — without it the poller can't run, so there's nothing to schedule. Idempotent.
// Reports availability via onStatus + the cached status so the UI can show a visible
// "reminders unavailable — finish setup" signal instead of failing silently (P2-20).
export function startLocalScheduler(onStatus?: (s: SchedulerStatus) => void): void {
  const set = (s: SchedulerStatus): void => {
    schedulerStatus = s
    onStatus?.(s)
  }
  if (timer) {
    onStatus?.(schedulerStatus) // already started — re-emit the known status for a late subscriber
    return
  }
  if (!existsSync(pyPath())) {
    console.warn("[scheduler] odysseus venv missing — local reminders disabled")
    set({ available: false, reason: "setup" })
    return
  }
  // Don't poll if we can't deliver: the poller CLAIMS (marks fired) the tasks it returns, so
  // polling with no way to show a notification would silently advance/complete due reminders
  // with nothing shown to the user (Bugbot). The paid server path delivers when we can't.
  if (!Notification.isSupported()) {
    console.warn("[scheduler] desktop notifications unavailable — local reminders disabled")
    set({ available: false, reason: "notifications" })
    return
  }
  stopped = false
  // A short initial delay so it doesn't race window/service startup; then every minute.
  timer = setInterval(runPoll, POLL_INTERVAL_MS)
  initialTimer = setTimeout(runPoll, 5_000)
  set({ available: true })
}

export function stopLocalScheduler(): void {
  stopped = true
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  if (initialTimer) {
    clearTimeout(initialTimer)
    initialTimer = null
  }
}
