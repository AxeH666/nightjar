// App — thin composition of the context providers around AppBody. Nearly all
// state that used to live in this file now lives in ./context/* (redesign
// Stage 2). Provider nesting order matters (outer → inner, by dependency
// direction): Connection → Model → Artifact → Chat → Permission.
//   • Artifact sits above Chat so the chat reducer can delegate to onToolCall.
//   • Permission is innermost so its abort can clear Chat's busy flag.
// AppBody is the current single-screen layout; Stage 5 replaces it with the
// tab shell (Chat/Cowork/Code).
import { ConnectionProvider, useConnection } from "./context/ConnectionContext"
import { ModelProvider, useModel } from "./context/ModelContext"
import { ArtifactProvider, useArtifact } from "./context/ArtifactContext"
import { SessionsProvider, useSessions } from "./context/SessionsContext"
import { PermissionProvider, usePermission } from "./context/PermissionContext"
import { LOCAL_MODEL } from "./lib/byok"
import { ChatSurface } from "./components/ChatSurface"
import { ArtifactPanel } from "./components/ArtifactPanel"
import { ModeSelector } from "./components/ModeSelector"
import { SuggestionBanner } from "./components/SuggestionBanner"
import { PermissionPanel } from "./components/PermissionPanel"
import { NightjarOrb } from "./components/orb/NightjarOrb"
import { HealthStrip } from "./components/HealthStrip"
import { ModelSwitcher } from "./components/ModelSwitcher"
import { CloudBanner } from "./components/CloudBanner"
import { VisionBanner } from "./components/VisionBanner"
import { BYOKSettings } from "./components/BYOKSettings"

export default function App() {
  return (
    <ConnectionProvider>
      <ModelProvider>
        <ArtifactProvider>
          <SessionsProvider>
            <PermissionProvider>
              <AppBody />
            </PermissionProvider>
          </SessionsProvider>
        </ArtifactProvider>
      </ModelProvider>
    </ConnectionProvider>
  )
}

function AppBody() {
  const { agents, status, services, wsUrl, reconnect, setStatus } = useConnection()
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
  const {
    sessions,
    slots,
    messagesOf,
    busyOf,
    send,
    createImage,
    setSessionAgent,
    suggestion,
    setSuggestion,
    fallbackToLocal,
    acceptOpenRouterSwitch,
  } = useSessions()
  const { panelOpen, setPanelOpen, activeEntry, setActiveEntry, previewNonce, liveCode } = useArtifact()
  const { ask, reply, abort } = usePermission()

  // Pre-tab shell: the single visible conversation is the chat slot. Stage 5
  // surfaces the code slot in its own tab.
  const chatId = slots.chat
  const messages = messagesOf(chatId)
  const busy = busyOf(chatId)
  const mode = sessions[chatId]?.agent ?? ""

  return (
    <div className="flex h-full flex-col bg-nightjar-base">
      <header className="flex items-center gap-3 border-b border-nightjar-surface px-4 py-2">
        <span className="font-semibold text-nightjar-accent">Nightjar</span>
        {agents.length > 0 && <ModeSelector agents={agents} active={mode} onChange={(m) => setSessionAgent(chatId, m)} />}
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
              const t = rateLimitOffer.text
              setRateLimitOffer(null)
              setFallbackOffer(t) // still offer the local offline escape hatch
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

      {suggestion && (
        <SuggestionBanner
          suggested={suggestion}
          onAccept={() => {
            setSessionAgent(chatId, suggestion)
            setSuggestion(null)
          }}
          onDismiss={() => setSuggestion(null)}
        />
      )}

      <div className="flex min-h-0 flex-1">
        <main className="min-h-0 flex-1">
          <ChatSurface
            messages={messages}
            busy={busy}
            onSend={(text, atts) => send(chatId, text, { attachments: atts })}
            onCreateImage={(prompt) => createImage(chatId, prompt)}
          />
        </main>
        {panelOpen && (
          <ArtifactPanel
            sessionID={chatId}
            entry={activeEntry}
            nonce={previewNonce}
            live={liveCode}
            onSelectEntry={setActiveEntry}
            onClose={() => setPanelOpen(false)}
            className="min-h-0 w-[45%] border-l border-nightjar-surface"
          />
        )}
      </div>

      {ask && <PermissionPanel ask={ask} onReply={reply} onAbort={abort} />}
      {showKeys && (
        <BYOKSettings
          onClose={() => setShowKeys(false)}
          onChanged={() => {
            // key added/removed → engine was restarted; refresh model choices and
            // re-establish the session + SSE stream against the fresh engine (the
            // old session id and stream are dead after the restart).
            setStatus("applying key — reconnecting…")
            loadModels()
            reconnect()
          }}
        />
      )}
    </div>
  )
}
