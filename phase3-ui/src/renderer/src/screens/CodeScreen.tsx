// CodeScreen — the IDE-like coding tab (redesign Stage 5). Its own session slot
// (independent of Chat): a resumable session list on the left, the coding
// conversation in the middle, and the live-preview / Artifacts panel on the
// right. Always sends to the `coding` agent.
//
// The folder-select + auto-accept-edits controls are honest SCAFFOLDS — the
// affordances are here but disabled, pending backend support (workspace switching
// + an auto-approve permission mode). Flagged, not faked.
import { useEffect } from "react"
import { useSessions } from "../context/SessionsContext"
import { useArtifact } from "../context/ArtifactContext"
import { usePermission } from "../context/PermissionContext"
import { useConnection } from "../context/ConnectionContext"
import { ChatSurface } from "../components/ChatSurface"
import { ArtifactPanel } from "../components/ArtifactPanel"
import { SessionList } from "../components/code/SessionList"

export function CodeScreen() {
  const { slots, sessions, messagesOf, busyOf, send, createImage } = useSessions()
  const { abortSession } = usePermission()
  const { connected } = useConnection()
  const { panelOpen, setPanelOpen, activeEntry, setActiveEntry, previewNonce, liveCode, syncCodeSession } = useArtifact()
  const id = slots.code
  const title = sessions[id]?.title ?? "Coding session"

  // Reset the live preview only when the code slot actually switches sessions.
  // syncCodeSession tracks the previous id in the persistent ArtifactProvider, so a
  // bare remount from a Chat↔Code tab switch (unchanged id) no longer wipes the
  // panel — it re-lists the still-live sandbox instead.
  useEffect(() => {
    syncCodeSession(id)
  }, [id, syncCodeSession])

  return (
    <div className="flex h-full min-h-0">
      <SessionList activeId={id} />
      <div className="flex min-h-0 flex-1 flex-col">
        {/* IDE toolbar. folder-select + auto-accept-edits are scaffolds (see header). */}
        <div className="flex items-center gap-3 border-b border-nightjar-surface px-4 py-1.5 text-xs">
          <span className="max-w-[16rem] truncate text-nightjar-text/70" title={title}>
            {title}
          </span>
          <span className="text-nightjar-text/20" aria-hidden>·</span>
          <button
            disabled
            title="Folder select — coming soon"
            className="cursor-not-allowed text-nightjar-text/30"
          >
            📁 workspace
          </button>
          <label
            className="ml-auto flex cursor-not-allowed items-center gap-1.5 text-nightjar-text/30"
            title="Auto-accept edits — coming soon"
          >
            <input type="checkbox" disabled className="accent-nightjar-accent" /> auto-accept edits
          </label>
        </div>
        <div className="flex min-h-0 flex-1">
          <main className="min-h-0 flex-1">
            <ChatSurface
              messages={messagesOf(id)}
              busy={busyOf(id)}
              blockedReason={connected ? null : "Connecting to the engine…"}
              onSend={(text, { attachments }) => send(id, text, { agent: "coding", attachments })}
              onCreateImage={(prompt) => createImage(id, prompt)}
              onStop={() => abortSession(id)}
              menu={{ research: false, webSearch: false, createImage: false }}
              emptyHint="Describe what to build — the coding agent writes files, previewed here."
              placeholder="Message the coding agent…  (Enter to send · paste or drop files)"
              assistantLabel="coding"
            />
          </main>
          {panelOpen && (
            <ArtifactPanel
              sessionID={id}
              entry={activeEntry}
              nonce={previewNonce}
              live={liveCode}
              onSelectEntry={setActiveEntry}
              onClose={() => setPanelOpen(false)}
              className="min-h-0 w-[45%] border-l border-nightjar-surface"
            />
          )}
        </div>
      </div>
    </div>
  )
}
