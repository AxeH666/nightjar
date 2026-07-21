import { useEffect, useMemo, useState } from "react"
import { useSessions } from "../../context/SessionsContext"
import { usePermission } from "../../context/PermissionContext"
import { useConnection } from "../../context/ConnectionContext"
import { useArtifact } from "../../context/ArtifactContext"
import { ChatSurface } from "../ChatSurface"
import { ArtifactPanel } from "../ArtifactPanel"
import { SessionList } from "../SessionList"

// 5b — a project's chats: a collapsible history rail (multiple named chats) + the active
// conversation, each bound to its own OpenCode session so it's isolated per project. Mirrors
// ChatScreen's wiring but against the project's active session (projectChats[projectId]) and its
// own history list. The active id comes from context state, so a reconnect that keeps the session
// never blanks the transcript. Image-gen is left off here in 5b (a second send path PR-C's cloud
// gate must also cover).
const AGENT_FOR_MODE = { research: "research", websearch: "websearch", none: "assistant" } as const

export function ProjectChat({ projectId }: { projectId: string }) {
  const { messagesOf, busyOf, send, createImage, openProjectChat, newProjectChat, resumeProjectChat, deleteProjectChatOne, projectChats, projectChatIds } =
    useSessions()
  const { abortSession } = usePermission()
  const { connected, sessionID } = useConnection()
  const { panelOpen, setPanelOpen, activeEntry, setActiveEntry, previewNonce, liveCode, artifactSession } = useArtifact()
  const [pending, setPending] = useState(true) // open/reconnect resolve in flight
  const [deleting, setDeleting] = useState(false) // a chat delete + its replacement resolving

  const id = projectChats[projectId] ?? "" // the active chat, driven by context state
  const history = useMemo(() => new Set(projectChatIds[projectId] ?? []), [projectChatIds, projectId])

  // Resolve/revalidate the project's active chat on open, project switch, and reconnect (sessionID
  // changes / goes empty→set). `pending` is true for the whole resolve; the transcript is never
  // blanked (id comes from context state, which survives a reconnect), but while pending/deleting
  // the composer is blocked so a message can't be SENT to a not-yet-resolved session. blockedReason
  // disables send but not Stop, so a mid-turn reconnect stays interruptible.
  useEffect(() => {
    let alive = true
    setPending(true)
    openProjectChat(projectId).finally(() => {
      if (alive) setPending(false)
    })
    return () => {
      alive = false
    }
  }, [projectId, sessionID, openProjectChat])

  // `deleting` covers the delete + replacement-resolution window, so no hard error flashes while a
  // deleted active chat is being replaced. When BOTH resolution paths are idle and there is still no
  // active chat (a genuine open/create failure, or a failed delete-replacement), show a single
  // ACTIONABLE message rather than trying to distinguish the two — the ＋ New chat button is right
  // there in the rail (Bugbot).
  const blockedReason = !connected
    ? "Connecting to the engine…"
    : deleting
      ? "Opening this project's chat…"
      : pending
        ? id
          ? "Reconnecting…"
          : "Opening this project's chat…"
        : id
          ? null
          : "Couldn't open a chat here — try ＋ New chat, or check the engine."

  return (
    <div className="flex h-full min-h-0">
      <SessionList
        sessionIds={history}
        activeId={id}
        onNew={() => void newProjectChat(projectId)}
        onResume={(sid) => void resumeProjectChat(projectId, sid)}
        onDelete={(sid) => {
          // RETURN the promise so SessionList awaits the full delete + replacement before refreshing
          // the rail (Bugbot); `deleting` blocks the composer for that window.
          setDeleting(true)
          return deleteProjectChatOne(projectId, sid).finally(() => setDeleting(false))
        }}
        pinKey={`nightjar.pinned.chat.${projectId}`}
        label="Chats"
        newTitle="New chat"
        collapsible
      />
      <main className="min-h-0 flex-1">
        <ChatSurface
          messages={messagesOf(id)}
          busy={busyOf(id)}
          blockedReason={blockedReason}
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
