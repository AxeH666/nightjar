// SessionList — a resumable session-history rail, generalized from the Code tab's original
// (redesign Stage 5) to any (slot, agent, sessionIds) so the Code tab AND every lab's left
// rail (Lab.md §4.1) share it. Lists sessions from GET /session, filtered to the ids our
// registry marks for THIS slot (GET /session has no per-session kind tag — see
// SessionsContext), so other slots' conversations never appear and can't be hijacked into
// this slot. Clicking one resumes it into the slot; New spins a fresh session on its agent.
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSessions } from "../context/SessionsContext"
import type { SlotId } from "../context/SessionsContext"
import type { SessionInfo } from "../lib/opencode"

export function SessionList({
  slot,
  agent,
  sessionIds,
  activeId,
  label = "Sessions",
  newTitle = "New session",
  chrome = true,
}: {
  slot: SlotId
  agent: string
  sessionIds: Set<string>
  activeId: string
  label?: string
  newTitle?: string
  // Code renders the self-contained w-56 sidebar (chrome=true, the default); a lab rail
  // supplies its own container and passes chrome={false} so the list just fills the space.
  chrome?: boolean
}) {
  const { listSessions, resumeSession, newSession } = useSessions()
  const [items, setItems] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setItems(await listSessions())
    setLoading(false)
  }, [listSessions])

  // Refresh when the active session changes (a new/resumed session should appear).
  useEffect(() => {
    refresh()
  }, [refresh, activeId])

  // GET /session returns EVERY session with no per-session kind tag; show only the ids our
  // registry marks for THIS slot (created/resumed here; persisted client-side), so other
  // slots' conversations never appear. Exclude agent-task sub-sessions (parentID). The
  // active session is always in the registry; `|| s.id === activeId` guards a first-render
  // race before the mark propagates.
  const visible = useMemo(
    () => items.filter((s) => (sessionIds.has(s.id) || s.id === activeId) && !s.parentID),
    [items, sessionIds, activeId],
  )

  return (
    <div className={chrome ? "flex w-56 shrink-0 flex-col border-r border-nightjar-surface" : "flex h-full min-h-0 flex-col"}>
      <div className="flex items-center justify-between border-b border-nightjar-surface px-3 py-2">
        <span className="text-xs uppercase tracking-wide text-nightjar-text/40">{label}</span>
        <div className="flex gap-1">
          <button
            onClick={() => newSession(slot, agent)}
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
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {visible.map((s) => (
          <button
            key={s.id}
            onClick={() => resumeSession(slot, s.id, agent, s.title)}
            title={s.title || s.id}
            className={`block w-full truncate px-3 py-2 text-left text-sm ${
              s.id === activeId
                ? "bg-nightjar-accent/10 text-nightjar-accent"
                : "text-nightjar-text/70 hover:bg-nightjar-surface"
            }`}
          >
            {s.title || s.id.slice(0, 8)}
          </button>
        ))}
        {visible.length === 0 && (
          <div className="px-3 py-2 text-xs text-nightjar-text/30">{loading ? "loading…" : "no sessions yet"}</div>
        )}
      </div>
    </div>
  )
}
