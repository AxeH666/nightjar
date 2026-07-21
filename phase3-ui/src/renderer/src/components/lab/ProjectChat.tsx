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
  const [pending, setPending] = useState(true)
  const [resolveFailed, setResolveFailed] = useState(false)

  const id = projectChats[projectId] ?? "" // the active chat, driven by context state
  const history = useMemo(() => new Set(projectChatIds[projectId] ?? []), [projectChatIds, projectId])

  // Resolve/revalidate the project's active chat on open, project switch, and reconnect (sessionID
  // changes / goes empty→set). `pending` is true for the whole resolve; the transcript is never
  // blanked (id comes from context state, which survives a reconnect), but while pending the
  // composer is blocked so a message can't be SENT to a not-yet-revalidated (possibly dead) session
  // (Bugbot). blockedReason disables send but not Stop, so a mid-turn reconnect stays interruptible.
  // resolveFailed is set ONLY when openProjectChat genuinely returned "" (a createSession error) —
  // NOT when it resolved a non-active id (e.g. its chat was deleted mid-open and a replacement is
  // already resolving), so the hard error doesn't flash while recovery is in progress (Bugbot).
  useEffect(() => {
    let alive = true
    setPending(true)
    openProjectChat(projectId)
      .then((rid) => {
        if (alive) setResolveFailed(rid === "")
      })
      .catch(() => {
        if (alive) setResolveFailed(true)
      })
      .finally(() => {
        if (alive) setPending(false)
      })
    return () => {
      alive = false
    }
  }, [projectId, sessionID, openProjectChat])

  const blockedReason = !connected
    ? "Connecting to the engine…"
    : pending
      ? id
        ? "Reconnecting…"
        : "Opening this project's chat…"
      : id
        ? null
        : resolveFailed
          ? "Couldn't open this project's chat — check the engine, then reopen the project."
          : "Opening this project's chat…" // resolved a non-active id → a replacement is on the way

  return (
    <div className="flex h-full min-h-0">
      <SessionList
        sessionIds={history}
        activeId={id}
        onNew={() => void newProjectChat(projectId)}
        onResume={(sid) => void resumeProjectChat(projectId, sid)}
        onDelete={(sid) => void deleteProjectChatOne(projectId, sid)}
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
