import { useEffect, useMemo, useRef, useState } from "react"
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
  const { messagesOf, busyOf, send, createImage, openProjectChat, newProjectChat, resumeProjectChat, projectChats, projectChatIds } =
    useSessions()
  const { abortSession } = usePermission()
  const { connected, sessionID } = useConnection()
  const { panelOpen, setPanelOpen, activeEntry, setActiveEntry, previewNonce, liveCode, artifactSession } = useArtifact()
  const [resolving, setResolving] = useState(true)
  const prevProjectId = useRef<string | null>(null)

  const id = projectChats[projectId] ?? "" // the active chat, driven by context state
  const history = useMemo(() => new Set(projectChatIds[projectId] ?? []), [projectChatIds, projectId])

  // Resolve the project's active chat on open, on project switch, and on reconnect (sessionID
  // changes / goes empty→set). `resolving` is set only on a project SWITCH, so a reconnect that
  // keeps the session shows no "Opening" flash (the active id stays put in context state).
  useEffect(() => {
    let alive = true
    if (prevProjectId.current !== projectId) {
      prevProjectId.current = projectId
      setResolving(true)
    }
    openProjectChat(projectId).then(() => {
      if (alive) setResolving(false)
    })
    return () => {
      alive = false
    }
  }, [projectId, sessionID, openProjectChat])

  const blockedReason = !connected
    ? "Connecting to the engine…"
    : resolving && !id
      ? "Opening this project's chat…"
      : !id
        ? "Couldn't open this project's chat — check the engine, then reopen the project."
        : null

  return (
    <div className="flex h-full min-h-0">
      <SessionList
        sessionIds={history}
        activeId={id}
        onNew={() => void newProjectChat(projectId)}
        onResume={(sid) => void resumeProjectChat(projectId, sid)}
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
