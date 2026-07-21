// SessionList — a resumable, collapsible session-history rail with a per-chat ⋯ menu (Rename /
// Pin / Move / Delete). Generalized from the Code tab's original (redesign Stage 5) to serve any
// list of session ids: the Code tab and every lab pass a (slot, agent) and it drives newSession/
// resumeSession/deleteSession on that slot; a PROJECT passes onNew/onResume/onDelete so the same
// rail drives per-project chats (5b). Lists sessions from GET /session, filtered to the ids our
// registry marks for THIS list. Titles come from the engine's auto-titling (displayChatTitle
// shows "New chat" until a real title lands). Pinning (when pinKey is set) persists a per-rail set
// and sorts pinned chats to the top. Move (chat rails only, via onMove/currentScope/moveTargets)
// re-files a chat to another scope (General ↔ project) — the ⋯ menu's Move sub-view + Remove-from-
// project shortcut.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSessions } from "../context/SessionsContext"
import { useConnection } from "../context/ConnectionContext"
import type { SlotId } from "../context/SessionsContext"
import type { SessionInfo } from "../lib/opencode"
import { displayChatTitle, loadPinned, savePinned, NEW_CHAT_LABEL, type ChatMoveScope } from "../lib/sessionScope"

export function SessionList({
  slot,
  agent,
  sessionIds,
  activeId,
  onNew,
  onResume,
  onDelete,
  pinKey,
  moveTargets,
  currentScope,
  onMove,
  label = "Sessions",
  newTitle = "New session",
  chrome = true,
  collapsible = false,
}: {
  // Either pass (slot, agent) for slot-driven new/resume/delete, OR onNew/onResume/onDelete for a
  // custom target (projects). The callbacks win when provided.
  slot?: SlotId
  agent?: string
  sessionIds: Set<string>
  activeId: string
  onNew?: () => void
  onResume?: (id: string, title?: string) => void
  onDelete?: (id: string) => void | Promise<void>
  // Enables the Pin menu item; the per-rail pinned set persists under this localStorage key.
  pinKey?: string
  // Enables the ⋯ menu's Move / Remove-from-project (chat rails only — Code/CAD pass none). The rail
  // is asked to move a chat between SCOPES; `currentScope` is this rail's own scope (excluded from
  // the picker and enabling "Remove from project"), `moveTargets` is the general-space project list.
  moveTargets?: Array<{ projectId: string; name: string }>
  currentScope?: ChatMoveScope
  onMove?: (sessionId: string, to: ChatMoveScope) => void | Promise<void>
  label?: string
  newTitle?: string
  chrome?: boolean
  collapsible?: boolean
}) {
  const { listSessions, resumeSession, newSession, deleteSession, renameSession } = useSessions()
  const { connected } = useConnection()
  const [items, setItems] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [pinned, setPinned] = useState<Set<string>>(() => (pinKey ? loadPinned(pinKey) : new Set()))
  const [bump, setBump] = useState(0) // manual refresh trigger (after rename/delete)

  useEffect(() => {
    setPinned(pinKey ? loadPinned(pinKey) : new Set())
  }, [pinKey])

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
  // Prune one id from this rail's pinned set (state + persist). togglePin is otherwise the only path
  // that removes from it, so a chat that leaves this rail — deleted, or moved to another scope —
  // would linger under pinKey forever (consistency sweep). Shared by doDelete and doMove.
  const dropPinned = useCallback(
    (id: string) => {
      if (!pinKey) return
      setPinned((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        savePinned(pinKey, next)
        return next
      })
    },
    [pinKey],
  )
  const doDelete = useCallback(
    async (id: string) => {
      // Deleting a chat needs the engine (to remove the session); without it, deleteSession no-ops
      // and a project delete would drop the rail entry client-side while orphaning the engine
      // session. So require a live connection — the composer is already blocked when disconnected,
      // so the user has the context (Bugbot).
      if (!connected) return
      // AWAIT the delete before refreshing: deleteSession removes the id from the persisted slot
      // history only AFTER its async engine-delete + active-slot rebind, so a non-awaited refresh
      // would re-list the just-deleted chat until that finished (Bugbot).
      if (onDelete) await onDelete(id)
      else await deleteSession(id)
      dropPinned(id)
      setBump((n) => n + 1)
    },
    [onDelete, deleteSession, connected, dropPinned],
  )
  const doMove = useCallback(
    async (id: string, to: ChatMoveScope) => {
      // Move re-tags id-lists client-side, but re-homing the ACTIVE chat needs the engine (to resolve
      // the source's replacement chat), so require a live connection like doDelete/doRename — the
      // composer is already blocked when disconnected, so the user has the context.
      if (!connected || !onMove || !currentScope) return
      await onMove(id, to)
      dropPinned(id) // moving unpins in THIS (source) rail — a pin is a per-rail position hint
      setBump((n) => n + 1)
    },
    [onMove, currentScope, connected, dropPinned],
  )
  const canMove = !!onMove && !!currentScope
  const doRename = useCallback(
    async (id: string, title: string) => {
      const t = title.trim()
      // renameSession no-ops without an engine client, so a rename would look applied (the inline
      // edit closes) while never persisting — require a live connection, matching doDelete (Bugbot).
      if (!t || !connected) return
      // AWAIT before refreshing — else listSessions can still return the OLD title and the rename
      // appears to vanish until the 4s timer refresh (Bugbot).
      await renameSession(id, t)
      setBump((n) => n + 1)
    },
    [renameSession, connected],
  )
  const togglePin = useCallback(
    (id: string) => {
      if (!pinKey) return
      setPinned((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        savePinned(pinKey, next)
        return next
      })
    },
    [pinKey],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setItems(await listSessions())
    setLoading(false)
  }, [listSessions])

  // Refresh when the active session changes or after a rename/delete, and once more shortly after,
  // so the engine's async auto-title (generated after the first message) shows up without a manual
  // refresh.
  useEffect(() => {
    refresh()
    const t = setTimeout(refresh, 4000)
    return () => clearTimeout(t)
  }, [refresh, activeId, bump])

  const visible = useMemo(() => {
    const filtered = items.filter((s) => (sessionIds.has(s.id) || s.id === activeId) && !s.parentID)
    // Pinned chats float to the top; otherwise keep listSessions' order (recent-first).
    return [...filtered].sort((a, b) => (pinned.has(b.id) ? 1 : 0) - (pinned.has(a.id) ? 1 : 0))
  }, [items, sessionIds, activeId, pinned])

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
          <SessionRow
            key={s.id}
            id={s.id}
            title={displayChatTitle(s.title)}
            active={s.id === activeId}
            pinned={pinned.has(s.id)}
            canPin={!!pinKey}
            moveTargets={canMove ? moveTargets : undefined}
            currentScope={canMove ? currentScope : undefined}
            onMove={canMove ? (to) => void doMove(s.id, to) : undefined}
            onOpen={() => doResume(s.id, s.title)}
            onRename={(t) => void doRename(s.id, t)}
            onTogglePin={() => togglePin(s.id)}
            onDelete={() => void doDelete(s.id)}
          />
        ))}
        {visible.length === 0 && (
          <div className="px-3 py-2 text-xs text-nightjar-text/30">
            {loading ? "loading…" : `no ${label.toLowerCase()} yet`}
          </div>
        )}
      </div>
    </div>
  )
}

// One chat row: click to open, a ⋯ menu (Rename / Pin / Move / Delete) revealed on hover, and inline
// rename (Enter commits, Escape cancels, blur commits — with a cancelRef so Escape's unmount-blur
// doesn't resurrect the cancelled edit, mirroring ProjectCard). R/P/M/D shortcuts fire while the menu
// is open. Move (chat rails only) opens a picker sub-view of destination scopes; Escape backs out of
// the picker to the menu, then out of the menu.
function SessionRow({
  id,
  title,
  active,
  pinned,
  canPin,
  moveTargets,
  currentScope,
  onMove,
  onOpen,
  onRename,
  onTogglePin,
  onDelete,
}: {
  id: string
  title: string
  active: boolean
  pinned: boolean
  canPin: boolean
  moveTargets?: Array<{ projectId: string; name: string }>
  currentScope?: ChatMoveScope
  onMove?: (to: ChatMoveScope) => void
  onOpen: () => void
  onRename: (title: string) => void
  onTogglePin: () => void
  onDelete: () => void
}) {
  const [menu, setMenu] = useState(false)
  const [moving, setMoving] = useState(false) // menu is showing the Move-to picker sub-view
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(title)
  const cancelRef = useRef(false)
  const committedRef = useRef(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const canMove = !!onMove && !!currentScope
  // Focus the menu ONCE when it opens, so the R/P/M/D shortcuts land — not on every render (which a
  // recreated inline ref callback would do, stealing focus repeatedly).
  useEffect(() => {
    if (menu) menuRef.current?.focus()
  }, [menu])
  // Reset the picker sub-view whenever the menu closes, so it reopens at the main menu (not mid-move).
  useEffect(() => {
    if (!menu) setMoving(false)
  }, [menu])
  // Move destinations: every general-space project + "General (no project)", excluding THIS rail's
  // own scope (you can't move a chat to where it already is). Built here so the picker is a plain list.
  const moveEntries = useMemo<Array<{ key: string; label: string; to: ChatMoveScope }>>(() => {
    if (!currentScope) return []
    const out: Array<{ key: string; label: string; to: ChatMoveScope }> = []
    if (currentScope.kind !== "general") out.push({ key: "general", label: "General (no project)", to: { kind: "general" } })
    for (const p of moveTargets ?? []) {
      if (currentScope.kind === "project" && currentScope.projectId === p.projectId) continue
      out.push({ key: p.projectId, label: p.name || "Untitled project", to: { kind: "project", projectId: p.projectId } })
    }
    return out
  }, [moveTargets, currentScope])

  function commit() {
    if (cancelRef.current) {
      cancelRef.current = false
      setRenaming(false)
      return
    }
    // Enter fires commit AND then the input's unmount-blur fires it again; the committedRef makes
    // the trailing call a no-op so onRename isn't invoked twice (consistency sweep).
    if (committedRef.current) return
    committedRef.current = true
    onRename(draft)
    setRenaming(false)
  }
  const startRename = () => {
    committedRef.current = false
    setDraft(title === NEW_CHAT_LABEL ? "" : title)
    setRenaming(true)
    setMenu(false)
  }

  if (renaming) {
    return (
      <div className="px-2 py-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit()
            if (e.key === "Escape") {
              cancelRef.current = true
              setRenaming(false)
            }
          }}
          onBlur={commit}
          placeholder="Chat name…"
          className="w-full rounded bg-nightjar-base px-2 py-1 text-sm text-nightjar-text focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
        />
      </div>
    )
  }

  return (
    <div className={`group relative flex items-center ${active ? "bg-nightjar-accent/10" : "hover:bg-nightjar-surface"}`}>
      <button
        onClick={onOpen}
        title={title}
        className={`min-w-0 flex-1 truncate px-3 py-2 text-left text-sm ${active ? "text-nightjar-accent" : "text-nightjar-text/70"}`}
      >
        {pinned && <span className="mr-1 text-nightjar-text/40">📌</span>}
        {title}
      </button>
      <button
        onClick={() => setMenu((v) => !v)}
        title="More"
        className={`shrink-0 px-2 text-nightjar-text/40 hover:text-nightjar-text ${menu ? "" : "opacity-0 group-hover:opacity-100"}`}
      >
        ⋯
      </button>
      {menu && (
        <>
          {/* click-away backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
          <div
            ref={menuRef}
            tabIndex={-1}
            className="absolute right-2 top-8 z-20 flex flex-col rounded-lg border border-nightjar-surface bg-nightjar-base py-1 text-xs shadow-lg focus:outline-none"
            onKeyDown={(e) => {
              const k = e.key.toLowerCase()
              if (moving) {
                if (k === "escape") setMoving(false) // Escape backs out of the picker to the menu
                return
              }
              if (k === "r") startRename()
              else if (k === "p" && canPin) {
                onTogglePin()
                setMenu(false)
              } else if (k === "m" && canMove && moveEntries.length > 0) {
                setMoving(true)
              } else if (k === "d") {
                onDelete()
                setMenu(false)
              } else if (k === "escape") setMenu(false)
            }}
          >
            {moving ? (
              <MovePicker entries={moveEntries} onBack={() => setMoving(false)} onPick={(to) => { onMove?.(to); setMenu(false) }} />
            ) : (
              <>
                <MenuItem label="Rename" hint="R" onClick={startRename} />
                {canPin && (
                  <MenuItem
                    label={pinned ? "Unpin" : "Pin"}
                    hint="P"
                    onClick={() => {
                      onTogglePin()
                      setMenu(false)
                    }}
                  />
                )}
                {canMove && moveEntries.length > 0 && <MenuItem label="Move to…" hint="M" onClick={() => setMoving(true)} />}
                {canMove && currentScope?.kind === "project" && (
                  <MenuItem
                    label="Remove from project"
                    onClick={() => {
                      onMove?.({ kind: "general" }) // "remove from project" = move to General
                      setMenu(false)
                    }}
                  />
                )}
                <MenuItem
                  label="Delete"
                  hint="D"
                  danger
                  onClick={() => {
                    onDelete()
                    setMenu(false)
                  }}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({ label, hint, danger, onClick }: { label: string; hint?: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between gap-6 px-3 py-1 text-left hover:bg-nightjar-surface ${
        danger ? "text-nightjar-alert" : "text-nightjar-text/80"
      }`}
    >
      <span>{label}</span>
      {hint && <span className="text-nightjar-text/30">{hint}</span>}
    </button>
  )
}

// The Move-to sub-view of the ⋯ menu: a back row + a scrollable list of destination scopes. Names
// can be long and the list unbounded (many projects), so it truncates each row and scrolls within a
// capped height rather than growing the popover off-screen.
function MovePicker({
  entries,
  onPick,
  onBack,
}: {
  entries: Array<{ key: string; label: string; to: ChatMoveScope }>
  onPick: (to: ChatMoveScope) => void
  onBack: () => void
}) {
  return (
    <div className="flex max-h-64 min-w-[11rem] flex-col">
      <button
        onClick={onBack}
        className="flex items-center gap-1 border-b border-nightjar-surface px-3 py-1 text-left text-nightjar-text/50 hover:text-nightjar-text"
      >
        ‹ Move to
      </button>
      {entries.length === 0 ? (
        <div className="px-3 py-1 text-nightjar-text/30">Nowhere else to move to</div>
      ) : (
        <div className="overflow-y-auto py-1">
          {entries.map((e) => (
            <button
              key={e.key}
              onClick={() => onPick(e.to)}
              title={e.label}
              className="block w-full truncate px-3 py-1 text-left text-nightjar-text/80 hover:bg-nightjar-surface"
            >
              {e.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
