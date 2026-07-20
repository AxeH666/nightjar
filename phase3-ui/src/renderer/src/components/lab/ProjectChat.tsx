import { useEffect, useState } from "react"
import { useSessions } from "../../context/SessionsContext"
import { usePermission } from "../../context/PermissionContext"
import { useConnection } from "../../context/ConnectionContext"
import { useArtifact } from "../../context/ArtifactContext"
import { ChatSurface } from "../ChatSurface"
import { ArtifactPanel } from "../ArtifactPanel"

// 5b — a project's single persistent chat, bound to its own OpenCode session (resolved by
// SessionsContext.openProjectChat, resume-or-create). Mirrors ChatScreen's wiring but against
// the project's session id instead of slots.chat, so the conversation is isolated per project.
// The composer's research/web toggles resolve to the same agents as the General chat; image-gen
// is left off here in 5b (it is a second send path the PR-C cloud-egress gate must also cover).
const AGENT_FOR_MODE = { research: "research", websearch: "websearch", none: "assistant" } as const

export function ProjectChat({ projectId }: { projectId: string }) {
  const { messagesOf, busyOf, send, createImage, openProjectChat } = useSessions()
  const { abortSession } = usePermission()
  const { connected } = useConnection()
  const { panelOpen, setPanelOpen, activeEntry, setActiveEntry, previewNonce, liveCode, artifactSession, syncChatSession } =
    useArtifact()
  const [id, setId] = useState("")

  // Resolve (resume-or-create) this project's chat session on open, and whenever the project
  // switches. Clear the id first so a stale session's transcript never flashes for the new project.
  useEffect(() => {
    let alive = true
    setId("")
    openProjectChat(projectId).then((sid) => {
      if (alive) setId(sid)
    })
    return () => {
      alive = false
    }
  }, [projectId, openProjectChat])

  // Reset the live-preview when the bound session changes (mirrors ChatScreen.syncChatSession) so
  // a project's canvas doesn't bleed into another's.
  useEffect(() => {
    if (id) syncChatSession(id)
  }, [id, syncChatSession])

  return (
    <div className="flex h-full min-h-0">
      <main className="min-h-0 flex-1">
        <ChatSurface
          messages={messagesOf(id)}
          busy={busyOf(id)}
          blockedReason={connected && id ? null : "Connecting to the engine…"}
          artifactSessionID={id}
          onSend={(text, { attachments, mode }) => send(id, text, { agent: AGENT_FOR_MODE[mode ?? "none"], attachments })}
          onCreateImage={(prompt) => createImage(id, prompt)}
          onStop={() => abortSession(id)}
          menu={{ research: true, webSearch: true, createImage: false }}
        />
      </main>
      {panelOpen && artifactSession === id && id && (
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
  )
}
