// AppShell — the redesigned frame (Stage 5): wordmark + the tab bar + header
// cluster (model switcher, status, orb), the global privacy/health/offer banners,
// the active tab's screen, and the global overlays (permission panel + BYOK
// settings). Replaces the old flat single-screen AppBody. Consumes the context
// stack; owns only the active-tab state.
//
// v1 ships FOUR tabs: Chat, CAD (Prompt-to-CAD, Task 5), LAB (the discipline-lab hub,
// Lab.md), and Code. Cowork is deferred to v2 and is neither listed (TabBar) nor mounted.
import { useState } from "react"
import { useConnection } from "../context/ConnectionContext"
import { useModel } from "../context/ModelContext"
import { useSessions } from "../context/SessionsContext"
import { usePermission } from "../context/PermissionContext"
import { LOCAL_MODEL } from "../lib/byok"
import { applyGlobalMode } from "../lib/globalMode"
import { capabilities } from "../lib/capabilities"
import { useOnlineCapabilities } from "../lib/useOnlineCapabilities"
import { TabBar, type TabId } from "./TabBar"
import { ChatScreen } from "../screens/ChatScreen"
import { CadScreen } from "../screens/CadScreen"
import { LabScreen } from "../screens/LabScreen"
import { CodeScreen } from "../screens/CodeScreen"
import { ModelSwitcher } from "../components/ModelSwitcher"
import { CloudBanner } from "../components/CloudBanner"
import { CapabilityCloudBanner } from "../components/CapabilityCloudBanner"
import { HealthStrip } from "../components/HealthStrip"
import { VisionBanner } from "../components/VisionBanner"
import { SchedulerBanner } from "../components/SchedulerBanner"
import { PermissionPanel } from "../components/PermissionPanel"
import { BYOKSettings } from "../components/BYOKSettings"
import { NightjarOrb } from "../components/orb/NightjarOrb"

export function AppShell() {
  const [tab, setTab] = useState<TabId>("chat")
  // Bumped when the settings modal closes so the per-capability cloud banner re-reads
  // the persisted Online/Offline prefs the user may have just changed.
  const [capsRefresh, setCapsRefresh] = useState(0)
  const { status, connected, services, wsUrl, reconnect, setStatus } = useConnection()
  const {
    choices,
    activeModel,
    setActiveModel,
    activeChoice,
    showKeys,
    setShowKeys,
    fallbackOffer,
    setFallbackOffer,
    rateLimitOffer,
    setRateLimitOffer,
    loadModels,
  } = useModel()
  const { fallbackToLocal, acceptOpenRouterSwitch } = useSessions()
  const { ask, reply, abort } = usePermission()

  // Cloud-active indication (privacy). `online` = the non-chat capabilities set Online; fetched
  // once here and shared with CapabilityCloudBanner. `cloudActive` is true when ANY cloud target
  // is active (the chat model AND/OR a capability) — it drives the persistent ☁ in the model
  // switcher, so dismissing the (dismissible) banners never leaves zero cloud signal.
  const online = useOnlineCapabilities(capsRefresh)
  const cloudActive = !activeChoice.local || online.length > 0

  // "Switch to local" on the chat CloudBanner must take the WHOLE app local, not just chat —
  // otherwise image/vision/research/browser keep egressing while the user believes they went
  // private (a label/behavior mismatch). Mirrors CapabilitiesSettings.goLocal: bulk-offline the
  // capabilities first, then set the chat model local; if the bulk write fails, still switch chat
  // and leave the capability banner up honestly.
  const switchAllToLocal = async () => {
    const plan = applyGlobalMode({ target: { kind: "local" }, catalog: [], providers: [], localModelId: LOCAL_MODEL.id })
    try {
      await capabilities.setBulk(plan.prefs)
      setCapsRefresh((n) => n + 1)
    } catch {
      // capabilities couldn't switch (IPC/engine down) — leave them; CapabilityCloudBanner stays up.
    }
    setActiveModel(plan.chatModelId)
  }

  return (
    <div className="flex h-full flex-col bg-nightjar-base">
      <header className="flex items-center gap-4 border-b border-nightjar-surface px-4 py-2">
        <span className="font-semibold text-nightjar-accent">June</span>
        <TabBar tab={tab} onChange={setTab} />
        <div className="ml-auto flex items-center gap-3">
          <ModelSwitcher choices={choices} activeId={activeModel} onSelect={setActiveModel} onManageKeys={() => setShowKeys(true)} cloudActive={cloudActive} />
          <span className="text-xs text-nightjar-text/40" title={status}>{status}</span>
          {/* Manual escape hatch: the connect loop auto-retries, but if it ever wedges (or the
              user just wants to force it), this always-available control re-runs the connect. */}
          {!connected && (
            <button
              onClick={reconnect}
              title="Retry connecting to the engine"
              className="rounded border border-nightjar-surface px-2 py-0.5 text-xs text-nightjar-text/70 hover:bg-nightjar-surface"
            >
              ↻ Reconnect
            </button>
          )}
          <NightjarOrb wsUrl={wsUrl} />
        </div>
      </header>

      {/* Dismissible cloud-active indicators (privacy). Render nothing when local; they re-arm
          when the cloud target changes, and a persistent ☁ stays in the model switcher so a
          dismiss never leaves zero cloud signal. CloudBanner = the chat model;
          CapabilityCloudBanner = image/vision/research/browser set Online. */}
      <CloudBanner model={activeChoice} onSwitchLocal={switchAllToLocal} />
      <CapabilityCloudBanner online={online} />
      <HealthStrip services={services} />
      <VisionBanner />
      <SchedulerBanner />

      {rateLimitOffer && (
        <div className="flex items-center gap-3 border-b border-nightjar-alert/50 bg-nightjar-alert/10 px-4 py-2 text-sm text-nightjar-text/90">
          <span>You've hit your usage limit on {rateLimitOffer.provider}. Switch to a free OpenRouter model to continue?</span>
          <button
            onClick={acceptOpenRouterSwitch}
            className="rounded-md bg-nightjar-accent px-3 py-1 text-xs font-medium text-nightjar-base hover:brightness-110"
          >
            Switch to free OpenRouter
          </button>
          <button
            onClick={() => {
              setRateLimitOffer(null)
              // still offer the local offline escape hatch — for the SAME failing
              // session/slot (the offer carries them so the retry lands in the
              // right conversation, not always the chat slot).
              setFallbackOffer({ text: rateLimitOffer.text, kind: rateLimitOffer.kind, sessionId: rateLimitOffer.sessionId, slot: rateLimitOffer.slot })
            }}
            className="text-xs text-nightjar-text/50 hover:underline"
          >
            dismiss
          </button>
        </div>
      )}

      {fallbackOffer && (
        <div className="flex items-center gap-3 border-b border-nightjar-alert/50 bg-nightjar-alert/10 px-4 py-2 text-sm text-nightjar-text/90">
          <span>The cloud model failed (bad/expired key, rate limit, or provider down).</span>
          <button
            onClick={fallbackToLocal}
            className="rounded-md bg-nightjar-accent px-3 py-1 text-xs font-medium text-nightjar-base hover:brightness-110"
          >
            Retry on local model
          </button>
          <button onClick={() => setFallbackOffer(null)} className="text-xs text-nightjar-text/50 hover:underline">
            dismiss
          </button>
        </div>
      )}

      <main className="min-h-0 flex-1">
        {/* Both tabs stay MOUNTED — visibility toggled via CSS — so switching tabs never
            unmounts a screen and discards the composer draft (typed text + attached files)
            or the Code tab's live-preview state (B10). */}
        <div className={tab === "chat" ? "h-full" : "hidden"}>
          <ChatScreen />
        </div>
        <div className={tab === "cad" ? "h-full" : "hidden"}>
          <CadScreen />
        </div>
        <div className={tab === "lab" ? "h-full" : "hidden"}>
          <LabScreen onOpenSettings={() => setShowKeys(true)} />
        </div>
        {/* Cowork is deferred to v2 and is NOT mounted in the v1 build — see TabBar. */}
        <div className={tab === "code" ? "h-full" : "hidden"}>
          <CodeScreen />
        </div>
      </main>

      {/* Global overlays — a permission ask (from ANY session) must sit above the
          screen and every other layer, with its mandatory abort. */}
      {ask && <PermissionPanel ask={ask} onReply={reply} onAbort={abort} />}
      {showKeys && (
        <BYOKSettings
          onClose={() => {
            setShowKeys(false)
            setCapsRefresh((n) => n + 1) // re-read capability prefs the user may have changed
          }}
          onChanged={() => {
            setStatus("applying key — reconnecting…")
            loadModels()
            reconnect()
            setCapsRefresh((n) => n + 1)
          }}
        />
      )}
    </div>
  )
}
