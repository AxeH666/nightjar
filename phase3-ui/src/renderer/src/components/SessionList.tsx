// SessionList — a resumable, collapsible session-history rail. Generalized from the Code tab's
// original (redesign Stage 5) to serve any list of session ids: the Code tab and every lab pass a
// (slot, agent) and it drives newSession/resumeSession on that slot; a PROJECT passes onNew/onResume
// so the same rail drives per-project chats (5b). Lists sessions from GET /session, filtered to the
// ids our registry marks for THIS list (GET /session has no per-session kind tag), so other
// conversations never appear. Clicking one resumes it; ＋ starts a new one. Titles come from the
// engine's auto-titling (displayChatTitle shows "New chat" until a real title lands).
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSessions } from "../context/SessionsContext"
import type { SlotId } from "../context/SessionsContext"
import type { SessionInfo } from "../lib/opencode"
import { displayChatTitle } from "../lib/sessionScope"

export function SessionList({
  slot,
  agent,
  sessionIds,
  activeId,
  onNew,
  onResume,
  label = "Sessions",
  newTitle = "New session",
  chrome = true,
  collapsible = false,
}: {
  // Either pass (slot, agent) for slot-driven new/resume, OR onNew/onResume for a custom target
  // (projects). onNew/onResume win when provided.
  slot?: SlotId
  agent?: string
  sessionIds: Set<string>
  activeId: string
  onNew?: () => void
  onResume?: (id: string, title?: string) => void
  label?: string
  newTitle?: string
  // Code renders the self-contained w-56 sidebar (chrome=true, the default); a lab rail
  // supplies its own container and passes chrome={false} so the list just fills the space.
  chrome?: boolean
  // Show a collapse toggle (chat rails). Collapsed = a thin strip with expand + ＋.
  collapsible?: boolean
}) {
  const { listSessions, resumeSession, newSession } = useSessions()
  const [items, setItems] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const doNew = useCallback(() => {
    if (onNew) onNew()
    else if (slot) newSession(slot, agent ?? "assistant")
  }, [onNew, slot, agent, newSession])
  const doResume = useCallback(
    (id: string, title?: string) => {
      if (onResume) onResume(id, title)
      else if (slot) resumeSession(slot, id, agent ?? "assistant", title)
    },
    [onResume, slot, agent, resumeSession],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setItems(await listSessions())
    setLoading(false)
  }, [listSessions])

  // Refresh when the active session changes (a new/resumed session should appear) — and once more
  // shortly after, so the engine's async auto-title (generated after the first message) shows up
  // without a manual refresh.
  useEffect(() => {
    refresh()
    const t = setTimeout(refresh, 4000)
    return () => clearTimeout(t)
  }, [refresh, activeId])

  // GET /session returns EVERY session with no per-session kind tag; show only the ids our
  // registry marks for THIS list. Exclude agent-task sub-sessions (parentID). The active session
  // is always in the registry; `|| s.id === activeId` guards a first-render race before the mark
  // propagates.
  const visible = useMemo(
    () => items.filter((s) => (sessionIds.has(s.id) || s.id === activeId) && !s.parentID),
    [items, sessionIds, activeId],
  )

  if (collapsible && collapsed) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center gap-2 border-r border-nightjar-surface py-2">
        <button
          onClick={() => setCollapsed(false)}
          title={`Show ${label.toLowerCase()}`}
          className="rounded px-1.5 text-nightjar-text/60 hover:bg-nightjar-surface hover:text-nightjar-text"
        >
          ▸
        </button>
        <button
          onClick={doNew}
          title={newTitle}
          className="rounded px-1.5 text-nightjar-text/60 hover:bg-nightjar-surface hover:text-nightjar-accent"
        >
          ＋
        </button>
      </div>
    )
  }

  return (
    <div className={chrome ? "flex w-56 shrink-0 flex-col border-r border-nightjar-surface" : "flex h-full min-h-0 flex-col"}>
      <div className="flex items-center justify-between border-b border-nightjar-surface px-3 py-2">
        <span className="text-xs uppercase tracking-wide text-nightjar-text/40">{label}</span>
        <div className="flex gap-1">
          <button
            onClick={doNew}
            title={newTitle}
            className="rounded px-1.5 text-nightjar-text/60 hover:bg-nightjar-surface hover:text-nightjar-accent"
          >
            ＋
          </button>
          <button
            onClick={refresh}
            title="Refresh"
            className="rounded px-1.5 text-nightjar-text/60 hover:bg-nightjar-surface hover:text-nightjar-text"
          >
            ⟳
          </button>
          {collapsible && (
            <button
              onClick={() => setCollapsed(true)}
              title={`Hide ${label.toLowerCase()}`}
              className="rounded px-1.5 text-nightjar-text/60 hover:bg-nightjar-surface hover:text-nightjar-text"
            >
              ◂
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {visible.map((s) => (
          <button
            key={s.id}
            onClick={() => doResume(s.id, s.title)}
            title={displayChatTitle(s.title)}
            className={`block w-full truncate px-3 py-2 text-left text-sm ${
              s.id === activeId
                ? "bg-nightjar-accent/10 text-nightjar-accent"
                : "text-nightjar-text/70 hover:bg-nightjar-surface"
            }`}
          >
            {displayChatTitle(s.title)}
          </button>
        ))}
        {visible.length === 0 && (
          <div className="px-3 py-2 text-xs text-nightjar-text/30">{loading ? "loading…" : "no chats yet"}</div>
        )}
      </div>
    </div>
  )
}
