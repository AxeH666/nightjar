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
import { ChatSurface } from "../components/ChatSurface"
import { ArtifactPanel } from "../components/ArtifactPanel"
import { SessionList } from "../components/code/SessionList"

export function CodeScreen() {
  const { slots, sessions, messagesOf, busyOf, send, createImage } = useSessions()
  const { panelOpen, setPanelOpen, activeEntry, setActiveEntry, previewNonce, liveCode, resetPreview } = useArtifact()
  const id = slots.code
  const title = sessions[id]?.title ?? "Coding session"

  // Switching the code slot to another session (new/resumed) must clear the live
  // preview — otherwise the panel keeps showing the previous session's artifacts
  // against a sandbox that no longer holds them. ArtifactContext resets on the
  // chat primary's id, which doesn't change here, so we drive it from the code id.
  useEffect(() => {
    resetPreview()
  }, [id, resetPreview])

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
              onSend={(text, { attachments }) => send(id, text, { agent: "coding", attachments })}
              onCreateImage={(prompt) => createImage(id, prompt)}
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
