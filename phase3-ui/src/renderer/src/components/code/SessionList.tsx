// SessionList — the Code tab's resumable session-history sidebar (redesign
// Stage 5). Lists sessions from GET /session; clicking one resumes it into the
// code slot (rehydrating its transcript via GET /session/:id/message). New spins
// a fresh coding session.
import { useCallback, useEffect, useState } from "react"
import { useSessions } from "../../context/SessionsContext"
import type { SessionInfo } from "../../lib/opencode"

export function SessionList({ activeId }: { activeId: string }) {
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
        {items.map((s) => (
          <button
            key={s.id}
            onClick={() => resumeSession("code", s.id, "coding")}
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
        {items.length === 0 && (
          <div className="px-3 py-2 text-xs text-nightjar-text/30">{loading ? "loading…" : "no sessions yet"}</div>
        )}
      </div>
    </div>
  )
}
