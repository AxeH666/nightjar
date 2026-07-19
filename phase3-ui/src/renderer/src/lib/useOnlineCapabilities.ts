import { useEffect, useState } from "react"
import { capabilities, type CapabilityMeta, type CapabilityPref } from "./capabilities"

export interface OnlineCapability {
  name: string
  provider: string
}

// The non-chat capabilities currently set Online (cloud), with their provider. Shared by the
// header cloud indicator (the ModelSwitcher ☁ glyph) and CapabilityCloudBanner so both agree and
// the prefs are fetched once. Re-reads whenever `refresh` bumps (settings modal close, or a
// go-local switch). Empty outside the desktop app (no bridge). Mirrors the prior in-banner logic.
export function useOnlineCapabilities(refresh: number): OnlineCapability[] {
  const [online, setOnline] = useState<OnlineCapability[]>([])
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
  return online
}
