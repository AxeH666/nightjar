// SessionList — the Code tab's resumable session-history sidebar (redesign
// Stage 5). Lists sessions from GET /session; clicking one resumes it into the
// code slot (rehydrating its transcript via GET /session/:id/message). New spins
// a fresh coding session.
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSessions } from "../../context/SessionsContext"
import type { SessionInfo } from "../../lib/opencode"

export function SessionList({ activeId }: { activeId: string }) {
  const { codeSessionIds, listSessions, resumeSession, newSession } = useSessions()
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

  // GET /session returns EVERY session (chat, code, agent sub-sessions) with no
  // per-session kind tag. Show only sessions our registry knows as CODE sessions
  // (created/resumed in this tab; persisted client-side), so the live chat
  // conversation and unrelated histories never appear here — resuming the chat
  // session into the code slot would hijack it and force the coding agent on it.
  // Exclude agent-task sub-sessions (parentID) defensively. The active session is
  // always in the registry; `|| s.id === activeId` guards a first-render race
  // before the mark propagates.
  const visible = useMemo(
    () => items.filter((s) => (codeSessionIds.has(s.id) || s.id === activeId) && !s.parentID),
    [items, codeSessionIds, activeId],
  )

  return (
    <div className="flex w-56 shrink-0 flex-col border-r border-nightjar-surface">
      <div className="flex items-center justify-between border-b border-nightjar-surface px-3 py-2">
        <span className="text-xs uppercase tracking-wide text-nightjar-text/40">Sessions</span>
        <div className="flex gap-1">
          <button
            onClick={() => newSession("code", "coding")}
            title="New coding session"
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
            onClick={() => resumeSession("code", s.id, "coding", s.title)}
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
