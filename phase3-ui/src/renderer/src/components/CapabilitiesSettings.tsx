import { useEffect, useState } from "react"
import type { ByokProviderStatus } from "../lib/byok"
import {
  capabilities,
  availableOnlineProviders,
  nextOnlineProvider,
  type CapabilityId,
  type CapabilityMeta,
  type CapabilityPref,
} from "../lib/capabilities"

// Per-capability Online/Offline + provider selection, shown inside the BYOK settings
// modal. Replaces the implicit local-vs-cloud / provider precedence (image-gen
// OpenAI>OpenRouter; browser-use OpenRouter>OpenAI) with an EXPLICIT, persisted choice.
// Offline is the private, on-device default; Online requires picking exactly one
// configured provider — never an automatic winner.
//
// PR2 is UI + persistence only: the engine reads these prefs (and restarts to apply
// them) in later PRs, so flipping a row here RECORDS the intent without yet rerouting a
// live capability. `providers` comes from the parent (BYOK list) so provider
// availability updates live as keys are added/removed.
export function CapabilitiesSettings({ providers }: { providers: ByokProviderStatus[] }) {
  const [catalog, setCatalog] = useState<CapabilityMeta[]>([])
  const [uiIds, setUiIds] = useState<CapabilityId[]>([])
  const [prefs, setPrefs] = useState<Record<string, CapabilityPref>>({})

  useEffect(() => {
    ;(async () => {
      const cat = await capabilities.catalog()
      setCatalog(cat.capabilities)
      setUiIds(cat.ui)
      setPrefs(await capabilities.list())
    })()
  }, [])

  const configuredIds = providers.filter((p) => p.hasKey).map((p) => p.id)
  const nameOf = (id: string) => providers.find((p) => p.id === id)?.name ?? id

  async function update(id: CapabilityId, pref: CapabilityPref) {
    setPrefs((prev) => ({ ...prev, [id]: pref })) // optimistic
    await capabilities.set(id, pref)
    setPrefs(await capabilities.list()) // reflect any main-side sanitize (e.g. online→offline coercion)
  }

  const rows = uiIds.map((id) => catalog.find((c) => c.id === id)).filter(Boolean) as CapabilityMeta[]
  if (rows.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="border-t border-nightjar-surface pt-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-nightjar-text/60">Capabilities · Online / Offline</span>
        <p className="mt-1 text-[11px] leading-relaxed text-nightjar-text/50">
          Each capability runs <b>Offline</b> (on-device, private) by default. Switch one <b>Online</b> to use a cloud
          provider you pick explicitly — <b className="text-nightjar-alert">its data then leaves your machine</b>. Chat &amp;
          coding is chosen with the model switcher in the header.
        </p>
      </div>

      {rows.map((meta) => {
        const pref = prefs[meta.id] ?? { mode: "offline" }
        const online = pref.mode === "online"
        const available = availableOnlineProviders(meta.onlineProviders, configuredIds)
        const canOnline = available.length > 0
        // A previously-picked provider whose key was since removed — keep it visible
        // and flagged rather than silently dropping the user's stored choice.
        const dangling = online && pref.providerId && !available.includes(pref.providerId) ? pref.providerId : null

        return (
          <div key={meta.id} className="rounded-lg border border-nightjar-surface p-3">
            <div className="flex items-center gap-2">
              <span className="font-medium text-nightjar-text">{meta.name}</span>
              <div className="ml-auto flex overflow-hidden rounded-md border border-nightjar-surface text-xs">
                <button
                  onClick={() => update(meta.id, { mode: "offline" })}
                  className={`px-2.5 py-1 ${!online ? "bg-nightjar-accent text-nightjar-base" : "text-nightjar-text/70 hover:bg-nightjar-surface"}`}
                >
                  Offline
                </button>
                <button
                  onClick={() => canOnline && update(meta.id, { mode: "online", providerId: nextOnlineProvider(pref.providerId, available) })}
                  disabled={!canOnline}
                  title={canOnline ? "Use a cloud provider for this capability" : "Add a key for a supported provider first"}
                  className={`border-l border-nightjar-surface px-2.5 py-1 ${
                    online ? "bg-nightjar-alert text-nightjar-base" : "text-nightjar-text/70 hover:bg-nightjar-surface"
                  } disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  Online
                </button>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2 text-xs">
              {!online ? (
                <span className="text-nightjar-text/50">🔒 {meta.offlineLabel}</span>
              ) : (
                <>
                  <span className="text-nightjar-text/50">Provider:</span>
                  <select
                    value={pref.providerId ?? ""}
                    onChange={(e) => update(meta.id, { mode: "online", providerId: e.target.value })}
                    className="rounded-md border border-nightjar-alert bg-nightjar-surface px-2 py-1 text-nightjar-alert focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
                  >
                    {available.map((pid) => (
                      <option key={pid} value={pid}>
                        ☁ {nameOf(pid)}
                      </option>
                    ))}
                    {dangling && (
                      <option value={dangling}>⚠ {nameOf(dangling)} (key removed)</option>
                    )}
                  </select>
                </>
              )}
            </div>

            {online && !canOnline && (
              <p className="mt-2 text-[11px] text-nightjar-alert">
                No key set for {meta.onlineProviders.map(nameOf).join(" / ")}. Add one above, or switch back to Offline.
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
