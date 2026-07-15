import { useEffect, useMemo, useState } from "react"
import type { ByokProviderStatus } from "../lib/byok"
import { isLocalModel, LOCAL_MODEL } from "../lib/byok"
import { useModel } from "../context/ModelContext"
import { capabilities, type CapabilityMeta, type CapabilityPref } from "../lib/capabilities"
import {
  applyGlobalMode,
  deriveGlobalMode,
  providerCapabilitySummary,
  type CapabilityId,
  type CapabilitySupportMeta,
} from "../lib/globalMode"

// The ONE global Local/Cloud switch (Tasks 1+2). Replaces the previous four
// per-capability rows: Local = everything on-device (chat = local Qwen, image/research/
// vision/browser all offline); Cloud (provider X) = everything X *can* serve routed to X
// (chat = X's default model), and everything X can't serve stays offline — stated
// honestly, never a fabricated cloud route.
//
// This is a UI fan-out over the EXISTING per-capability prefs, not a replacement: it
// derives its displayed state from the store (deriveGlobalMode) and applies a switch by
// computing the whole prefs plan (applyGlobalMode) and writing it in ONE setBulk + one
// setActiveModel. All decision logic lives in the pure, unit-tested lib/globalMode.
//
// Human-readable capability labels for the support summary.
const CAP_LABEL: Record<CapabilityId, string> = {
  chat: "chat",
  image: "image",
  research: "research",
  vision: "vision",
  browser: "browser",
}

export function CapabilitiesSettings({ providers }: { providers: ByokProviderStatus[] }) {
  const { activeModel, setActiveModel } = useModel()
  const [catalog, setCatalog] = useState<CapabilityMeta[]>([])
  const [prefs, setPrefs] = useState<Record<string, CapabilityPref>>({})
  // The provider selected in the Cloud dropdown. Seeded from the derived mode; the user
  // can change it while Cloud, which re-applies the whole plan for the new provider.
  const [cloudProvider, setCloudProvider] = useState<string | null>(null)
  // Gate: the catalog + prefs load async. Until BOTH are in we cannot derive the real
  // mode (deriveGlobalMode needs the catalog) — deriving before then would mislabel a
  // cloud/mixed app as Local (Bugbot), and a switch computed against an empty catalog
  // would plan every capability offline even for a provider that supports them (Bugbot).
  // So we block interaction and show a loading line until ready.
  const [ready, setReady] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const cat = await capabilities.catalog()
      setCatalog(cat.capabilities)
      setPrefs(await capabilities.list())
      setReady(true)
    })()
  }, [])

  // Only providers with a configured key can be gone Cloud with.
  const configured = useMemo(() => providers.filter((p) => p.hasKey), [providers])
  // The catalog trimmed to what the pure helpers need (id + onlineProviders).
  const supportCatalog = useMemo<CapabilitySupportMeta[]>(
    () => catalog.map((c) => ({ id: c.id as CapabilityId, onlineProviders: c.onlineProviders })),
    [catalog],
  )
  // Shape byok statuses into what applyGlobalMode needs (id + defaultModel).
  const providerModels = useMemo(
    () => configured.map((p) => ({ id: p.id, defaultModel: p.defaultModel })),
    [configured],
  )
  const nameOf = (id: string) => providers.find((p) => p.id === id)?.name ?? id

  const chatIsLocal = isLocalModel(activeModel)
  const chatProviderId = chatIsLocal ? null : activeModel.slice(0, Math.max(0, activeModel.indexOf("/"))) || null
  // Only derive once ready — before the catalog is in, an empty catalog would collapse
  // every non-chat pref to "unsupported" and mislabel the true state as Local.
  const mode = useMemo(
    () =>
      ready
        ? deriveGlobalMode({ prefs, chatIsLocal, chatProviderId, catalog: supportCatalog })
        : ({ kind: "loading" } as const),
    [ready, prefs, chatIsLocal, chatProviderId, supportCatalog],
  )

  // The Cloud provider the app is actually on right now, even if its key was since removed
  // in this same modal (so it's gone from `configured`). We keep it visible + flagged
  // rather than letting the <select> hold a value with no matching option (Bugbot).
  const activeCloudProvider = mode.kind === "cloud" ? mode.providerId : null
  const danglingProvider =
    activeCloudProvider && !configured.some((p) => p.id === activeCloudProvider) ? activeCloudProvider : null

  // Keep the dropdown selection in sync with the derived Cloud provider; when Local or
  // Mixed, default the dropdown to the first configured provider so switching to Cloud
  // has something selected. If the selected provider's key was removed, drop back to a
  // still-configured one so the control never shows an option that no longer exists.
  useEffect(() => {
    if (mode.kind === "cloud") setCloudProvider(mode.providerId)
    else
      setCloudProvider((cur) =>
        cur && configured.some((p) => p.id === cur) ? cur : (configured[0]?.id ?? null),
      )
  }, [mode, configured])

  const isLocal = mode.kind === "local"
  const canCloud = ready && configured.length > 0

  // Apply a switch: compute the plan, persist all non-chat prefs in ONE bulk write, then
  // set the chat model. Order matters (Bugbot): setBulk is the call that can fail (IPC +
  // engine restart), so we await it FIRST — if it throws, we surface the error and leave
  // chat untouched, rather than moving the header model to a mode the capabilities never
  // reached. setActiveModel only runs after the bulk write has committed.
  async function apply(target: { kind: "local" } | { kind: "cloud"; providerId: string }) {
    if (!ready) return
    const plan = applyGlobalMode({
      target,
      catalog: supportCatalog,
      providers: providerModels,
      localModelId: LOCAL_MODEL.id,
    })
    setApplyError(null)
    try {
      const saved = await capabilities.setBulk(plan.prefs)
      if (saved && Object.keys(saved).length) setPrefs(saved)
      setActiveModel(plan.chatModelId)
    } catch (err) {
      setApplyError(
        `Couldn't apply that switch (${err instanceof Error ? err.message : String(err)}). Nothing was changed.`,
      )
    }
  }

  function goLocal() {
    void apply({ kind: "local" })
  }
  function goCloud(providerId: string) {
    setCloudProvider(providerId)
    void apply({ kind: "cloud", providerId })
  }

  const showCloudPanel = mode.kind === "cloud" || mode.kind === "mixed"
  const summary = cloudProvider ? providerCapabilitySummary(cloudProvider, supportCatalog) : null
  // The dropdown must always contain an option for its current value. If the active
  // provider's key was removed this session, append a flagged option so the <select>
  // never silently shows a value with no matching option.
  const dropdownProviders =
    danglingProvider && !configured.some((p) => p.id === danglingProvider)
      ? [...configured, { id: danglingProvider, name: `${nameOf(danglingProvider)} (key removed)`, hasKey: false } as ByokProviderStatus]
      : configured

  return (
    <div className="space-y-3">
      <div className="border-t border-nightjar-surface pt-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-nightjar-text/60">Local / Cloud</span>
        <p className="mt-1 text-[11px] leading-relaxed text-nightjar-text/50">
          One switch for everything — chat, image, research, vision, and the browser agent. <b>Local</b> keeps it all
          on-device and private. <b>Cloud</b> routes it to one provider you pick;{" "}
          <b className="text-nightjar-alert">its data then leaves your machine</b>.
        </p>
      </div>

      {!ready ? (
        <p className="text-[11px] text-nightjar-text/40">Loading current mode…</p>
      ) : (
        <>
          {/* The switch. */}
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-md border border-nightjar-surface text-sm">
              <button
                onClick={goLocal}
                className={`px-3 py-1.5 ${isLocal ? "bg-nightjar-accent text-nightjar-base" : "text-nightjar-text/70 hover:bg-nightjar-surface"}`}
              >
                🔒 Local
              </button>
              <button
                onClick={() => canCloud && cloudProvider && goCloud(cloudProvider)}
                disabled={!canCloud}
                title={canCloud ? "Route everything to a cloud provider" : "Add a provider key first"}
                className={`border-l border-nightjar-surface px-3 py-1.5 ${
                  mode.kind === "cloud" ? "bg-nightjar-alert text-nightjar-base" : "text-nightjar-text/70 hover:bg-nightjar-surface"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                ☁ Cloud
              </button>
            </div>

            {mode.kind === "mixed" && (
              <span className="text-[11px] text-nightjar-text/50">Mixed — pick Local or Cloud to normalize.</span>
            )}
          </div>

          {applyError && <p className="text-[11px] text-nightjar-alert">{applyError}</p>}

          {/* Cloud provider dropdown + honest per-provider support summary. */}
          {showCloudPanel && (
            <div className="space-y-2 rounded-lg border border-nightjar-alert/40 bg-nightjar-alert/5 p-3">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-nightjar-text/60">Provider:</span>
                <select
                  value={cloudProvider ?? ""}
                  onChange={(e) => goCloud(e.target.value)}
                  className="rounded-md border border-nightjar-alert bg-nightjar-surface px-2 py-1 text-nightjar-alert focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
                >
                  {dropdownProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.hasKey === false && p.id === danglingProvider ? "⚠ " : "☁ "}
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {danglingProvider && (
                <p className="text-[11px] text-nightjar-alert">
                  The key for {nameOf(danglingProvider)} was removed — add it back above, or pick another provider / switch to Local.
                </p>
              )}

              {summary && cloudProvider && (
                <p className="text-[11px] leading-relaxed text-nightjar-text/60">
                  <b>{nameOf(cloudProvider)}</b> — {summary.supported.map((c) => CAP_LABEL[c]).join(", ")} ✓
                  {summary.unsupported.length > 0 && (
                    <>
                      {" · "}
                      <span className="text-nightjar-text/45">
                        {summary.unsupported.map((c) => CAP_LABEL[c]).join("/")}: run locally (not supported)
                      </span>
                    </>
                  )}
                </p>
              )}
            </div>
          )}

          {isLocal && (
            <p className="text-[11px] text-nightjar-text/50">🔒 Everything on-device — chat on the local Qwen model.</p>
          )}
        </>
      )}
    </div>
  )
}
