// AppShell — the redesigned frame (Stage 5): wordmark + the three-tab bar +
// header cluster (model switcher, status, orb), the global privacy/health/offer
// banners, the active tab's screen, and the global overlays (permission panel +
// BYOK settings). Replaces the old flat single-screen AppBody. Consumes the
// context stack; owns only the active-tab state.
import { useState } from "react"
import { useConnection } from "../context/ConnectionContext"
import { useModel } from "../context/ModelContext"
import { useSessions } from "../context/SessionsContext"
import { usePermission } from "../context/PermissionContext"
import { LOCAL_MODEL } from "../lib/byok"
import { TabBar, type TabId } from "./TabBar"
import { ChatScreen } from "../screens/ChatScreen"
import { CoworkScreen } from "../screens/CoworkScreen"
import { CodeScreen } from "../screens/CodeScreen"
import { ModelSwitcher } from "../components/ModelSwitcher"
import { CloudBanner } from "../components/CloudBanner"
import { HealthStrip } from "../components/HealthStrip"
import { VisionBanner } from "../components/VisionBanner"
import { PermissionPanel } from "../components/PermissionPanel"
import { BYOKSettings } from "../components/BYOKSettings"
import { NightjarOrb } from "../components/orb/NightjarOrb"

export function AppShell() {
  const [tab, setTab] = useState<TabId>("chat")
  const { status, services, wsUrl, reconnect, setStatus } = useConnection()
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

  return (
    <div className="flex h-full flex-col bg-nightjar-base">
      <header className="flex items-center gap-4 border-b border-nightjar-surface px-4 py-2">
        <span className="font-semibold text-nightjar-accent">Nightjar</span>
        <TabBar tab={tab} onChange={setTab} />
        <div className="ml-auto flex items-center gap-3">
          <ModelSwitcher choices={choices} activeId={activeModel} onSelect={setActiveModel} onManageKeys={() => setShowKeys(true)} />
          <span className="text-xs text-nightjar-text/40">{status}</span>
          <NightjarOrb wsUrl={wsUrl} />
        </div>
      </header>

      {/* Unmissable cloud-active indicator (privacy). Renders nothing when local. */}
      <CloudBanner model={activeChoice} onSwitchLocal={() => setActiveModel(LOCAL_MODEL.id)} />
      <HealthStrip services={services} />
      <VisionBanner />

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
              setFallbackOffer({ text: rateLimitOffer.text, sessionId: rateLimitOffer.sessionId, slot: rateLimitOffer.slot })
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
        {tab === "chat" && <ChatScreen />}
        {tab === "cowork" && <CoworkScreen />}
        {tab === "code" && <CodeScreen />}
      </main>

      {/* Global overlays — a permission ask (from ANY session) must sit above the
          screen and every other layer, with its mandatory abort. */}
      {ask && <PermissionPanel ask={ask} onReply={reply} onAbort={abort} />}
      {showKeys && (
        <BYOKSettings
          onClose={() => setShowKeys(false)}
          onChanged={() => {
            setStatus("applying key — reconnecting…")
            loadModels()
            reconnect()
          }}
        />
      )}
    </div>
  )
}
