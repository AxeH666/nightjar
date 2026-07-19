import { useState } from "react"
import type { ModelChoice } from "../lib/byok"

// Indicator that the active CHAT model is a CLOUD model — data leaves the machine, breaking the
// default offline/local-first promise. Dismissible (✕), but RE-ARMS when the cloud model changes
// (the dismissed state is keyed to `model.id`), so switching to a different cloud model re-shows
// it. Renders nothing when the local model is active. A persistent quiet ☁ stays in the model
// switcher even after dismissal, so a dismiss never leaves zero cloud signal (the privacy intent).
// role="status" (not "alert") so a screen reader doesn't assertively re-announce this standing
// indicator on every mount.
export function CloudBanner({ model, onSwitchLocal }: { model: ModelChoice; onSwitchLocal: () => void }) {
  const [dismissedId, setDismissedId] = useState<string | null>(null)
  if (model.local) return null
  if (dismissedId === model.id) return null // dismissed for THIS cloud model; re-arms on model change
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-nightjar-alert bg-nightjar-alert/90 px-4 py-2 text-sm text-nightjar-text"
    >
      <span className="text-base">☁</span>
      <span className="font-semibold uppercase tracking-wide">Cloud model active</span>
      <span className="text-nightjar-text/90">
        Messages are sent to <b>{model.providerName}</b> — data leaves your machine (not local/offline).
      </span>
      <button
        onClick={onSwitchLocal}
        className="ml-auto rounded border border-nightjar-text/40 px-2 py-0.5 text-xs font-medium hover:bg-nightjar-text/10"
      >
        Switch to local
      </button>
      <button
        onClick={() => setDismissedId(model.id)}
        aria-label="Dismiss this cloud notice"
        title="Dismiss — a ☁ stays in the model switcher; this re-shows if the cloud model changes"
        className="rounded px-2 py-0.5 text-sm font-medium text-nightjar-text/80 hover:bg-nightjar-text/10"
      >
        ✕
      </button>
    </div>
  )
}
