import { useEffect, useMemo, useState } from "react"
import { useSessions } from "../../context/SessionsContext"
import { usePermission } from "../../context/PermissionContext"
import { useConnection } from "../../context/ConnectionContext"
import { useArtifact } from "../../context/ArtifactContext"
import { ChatSurface } from "../ChatSurface"
import { ArtifactPanel } from "../ArtifactPanel"
import { SessionList } from "../SessionList"
import { ProjectContextConsentBanner } from "./ProjectContextConsentBanner"
import { pinnedChatsKey, unreadChatsKey } from "../../lib/sessionScope"
import { useProjects } from "../../lib/projects"
import { hasCloudConsent, allowCloudConsent, buildProjectSystem, hasProjectContext } from "../../lib/projectContent"
import { useModel } from "../../context/ModelContext"
import { LOCAL_MODEL } from "../../lib/byok"

// 5b — a project's chats: a collapsible history rail (multiple named chats) + the active
// conversation, each bound to its own OpenCode session so it's isolated per project. Mirrors
// ChatScreen's wiring but against the project's active session (projectChats[projectId]) and its
// own history list. The active id comes from context state, so a reconnect that keeps the session
// never blanks the transcript. This view attaches the project's knowledge — Instructions (PR-C) +
// Memory (AM-1) — to each send as system context, GATED by per-project cloud consent (the banner
// below) and computed from the SAME live values the banner uses; image-gen stays OFF here
// (createImage: false), so the text send path is the only egress the gate must cover.
const AGENT_FOR_MODE = { research: "research", websearch: "websearch", none: "assistant" } as const

export function ProjectChat({ projectId, instructions = "", memory = "" }: { projectId: string; instructions?: string; memory?: string }) {
  const { messagesOf, busyOf, send, createImage, openProjectChat, newProjectChat, resumeProjectChat, deleteProjectChatOne, moveChatToScope, projectChats, projectChatIds } =
    useSessions()
  // The general-space Projects are this chat's Move destinations (to another project, or "Remove
  // from project" = General). This project is excluded from the picker by currentScope below.
  const { projects } = useProjects("general")
  const { abortSession } = usePermission()
  const { connected, sessionID } = useConnection()
  const { activeChoice, setActiveModel } = useModel()
  const { panelOpen, setPanelOpen, activeEntry, setActiveEntry, previewNonce, liveCode, artifactSession } = useArtifact()
  const [pending, setPending] = useState(true) // open/reconnect resolve in flight
  const [deleting, setDeleting] = useState(false) // a chat delete + its replacement resolving
  const [moving, setMoving] = useState(false) // a chat move + its active-chat replacement resolving
  // Per-project cloud-egress consent for this project's knowledge (Instructions + Memory). Held in
  // state (reloaded when the project changes, updated when Allow persists) and used for BOTH the
  // banner and the send-time gate below — so the banner and what's actually sent can never disagree.
  const [consented, setConsented] = useState(() => hasCloudConsent(projectId))
  useEffect(() => {
    setConsented(hasCloudConsent(projectId))
  }, [projectId])

  const id = projectChats[projectId] ?? "" // the active chat, driven by context state
  const history = useMemo(() => new Set(projectChatIds[projectId] ?? []), [projectChatIds, projectId])
  // `instructions` + `memory` come from ProjectView's LIVE content instance (reactive to Knowledge-tab
  // edits). The SAME values drive both the consent banner and the send-time injection, so what the user
  // sees is exactly what's sent — no live-vs-storage split-brain. buildProjectSystem bakes in the gate
  // (returns undefined when empty, or when a cloud model lacks consent → withhold ALL project knowledge).
  const projectSystem = buildProjectSystem({ instructions, memory, isLocal: activeChoice.local, consent: consented })
  const showConsent = connected && !activeChoice.local && hasProjectContext({ instructions, memory }) && !consented

  // Resolve the project's active chat on open, project switch, and reconnect (sessionID changes /
  // goes empty→set). A still-bound chat is returned as-is — there is NO liveness re-check (the
  // lazy model; sessions persist in the engine DB). `pending` is true for the whole resolve; the
  // transcript is never blanked (id comes from context state, which survives a reconnect), but
  // while pending/deleting the composer is blocked so a message can't be SENT to a not-yet-resolved
  // session. blockedReason disables send but not Stop, so a mid-turn reconnect stays interruptible.
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
    : moving
      ? "Moving this chat…" // block sends while an active-chat move re-homes the session (gcSessions would else abort a send)
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
        pinKey={pinnedChatsKey(projectId)}
        unreadKey={unreadChatsKey(projectId)}
        moveTargets={projects.map((p) => ({ projectId: p.id, name: p.name }))}
        currentScope={{ kind: "project", projectId }}
        onMove={(sid, to) => {
          // Block the composer while the move re-homes the active chat (mirrors onDelete's `deleting`),
          // so a send can't land on the session being moved just before gcSessions reaps/aborts it
          // (Bugbot). RETURN the promise so SessionList awaits it (and unpins only on a real move).
          setMoving(true)
          return moveChatToScope(sid, { kind: "project", projectId }, to).finally(() => setMoving(false))
        }}
        label="Chats"
        newTitle="New chat"
        collapsible
      />
      <main className="flex min-h-0 flex-1 flex-col">
        {showConsent && (
          <ProjectContextConsentBanner
            provider={activeChoice.providerName ?? "the cloud model"}
            onAllow={() => {
              // Flip consent in state ONLY if the write PERSISTED. The `consented` state directly gates
              // egress (via projectSystem), so an optimistic flip on a failed write would send this
              // project's knowledge to the cloud on a consent that won't survive a reload. If the write
              // fails the banner stays and nothing egresses — honest and safe (PR-C/AM-1).
              if (allowCloudConsent(projectId)) setConsented(true)
            }}
            onSwitchLocal={() => setActiveModel(LOCAL_MODEL.id)}
          />
        )}
        <div className="min-h-0 flex-1">
          <ChatSurface
            messages={messagesOf(id)}
            busy={busyOf(id)}
            blockedReason={blockedReason}
            artifactSessionID={id}
            onSend={(text, { attachments, mode }) =>
            send(id, text, { agent: AGENT_FOR_MODE[mode ?? "none"], attachments, system: projectSystem })
          }
            onCreateImage={(prompt) => createImage(id, prompt)}
            onStop={() => abortSession(id)}
            menu={{ research: true, webSearch: true, createImage: false }}
          />
        </div>
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
