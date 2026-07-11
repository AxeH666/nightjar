import { useEffect, useState } from "react"
import { capabilities, type CapabilityMeta, type CapabilityPref } from "../lib/capabilities"

// Loud indicator of which NON-chat capabilities are running Online (cloud) — data for
// those leaves the machine. Complements CloudBanner (which covers the chat model).
// Renders nothing when every capability is Offline (the default, safe state). Re-reads
// the persisted prefs whenever `refresh` changes (bumped when the settings modal closes).
export function CapabilityCloudBanner({ refresh }: { refresh: number }) {
  const [online, setOnline] = useState<Array<{ name: string; provider: string }>>([])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [cat, prefs] = await Promise.all([capabilities.catalog(), capabilities.list()])
      const rows = cat.ui
        .map((id) => ({ meta: cat.capabilities.find((c) => c.id === id), pref: prefs[id] as CapabilityPref | undefined }))
        .filter((r): r is { meta: CapabilityMeta; pref: CapabilityPref } => !!r.meta && r.pref?.mode === "online" && !!r.pref.providerId)
        .map((r) => ({ name: r.meta.name, provider: r.pref.providerId as string }))
      if (!cancelled) setOnline(rows)
    })()
    return () => {
      cancelled = true
    }
  }, [refresh])

  if (online.length === 0) return null
  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-nightjar-alert bg-nightjar-alert/90 px-4 py-2 text-sm text-nightjar-text"
    >
      <span className="text-base">☁</span>
      <span className="font-semibold uppercase tracking-wide">Cloud capability active</span>
      <span className="text-nightjar-text/90">
        {online.map((o) => `${o.name} → ${o.provider}`).join(" · ")} — this data leaves your machine.
      </span>
    </div>
  )
}
