import { useState } from "react"
import type { OnlineCapability } from "../lib/useOnlineCapabilities"

// Indicator of which NON-chat capabilities are running Online (cloud) — data for those leaves the
// machine. Complements CloudBanner (which covers the chat model). Renders nothing when every
// capability is Offline (the default, safe state). Dismissible (✕), but RE-ARMS whenever the set
// of online capabilities changes (a newly-onlined capability re-shows the bar — the privacy
// intent). A persistent quiet ☁ stays in the model switcher even after dismissal, so a dismiss
// never leaves zero cloud signal. role="status" (not "alert") so a screen reader doesn't
// assertively re-announce this standing indicator on every mount.
export function CapabilityCloudBanner({ online }: { online: OnlineCapability[] }) {
  const [dismissedSig, setDismissedSig] = useState<string | null>(null)
  const sig = online.map((o) => `${o.name}:${o.provider}`).join("|")
  if (online.length === 0) return null
  if (dismissedSig === sig) return null // dismissed for THIS exact set; re-arms when it changes
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-nightjar-alert bg-nightjar-alert/90 px-4 py-2 text-sm text-nightjar-text"
    >
      <span className="text-base">☁</span>
      <span className="font-semibold uppercase tracking-wide">Cloud capability active</span>
      <span className="text-nightjar-text/90">
        {online.map((o) => `${o.name} → ${o.provider}`).join(" · ")} — this data leaves your machine.
      </span>
      <button
        onClick={() => setDismissedSig(sig)}
        aria-label="Dismiss this cloud-capability notice"
        title="Dismiss — a ☁ stays in the model switcher; this re-shows if a capability goes online"
        className="ml-auto rounded px-2 py-0.5 text-sm font-medium text-nightjar-text/80 hover:bg-nightjar-text/10"
      >
        ✕
      </button>
    </div>
  )
}
