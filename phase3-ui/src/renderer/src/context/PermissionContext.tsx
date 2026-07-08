// PermissionContext — the safety-critical approval flow. Owns the pending `ask`,
// the reply (once/always/reject), and the session abort escape hatch. Renders
// GLOBAL: a permission from ANY session must surface, above every other overlay,
// with no server-side timeout (an unanswered ask blocks the agent loop
// indefinitely — hence the mandatory abort).
//
// Innermost provider: consumes ConnectionContext (client) and SessionsContext
// (hasSession — a permission from ANY of our sessions surfaces; setBusy, cleared
// on abort). Registers only the permission.* slice of the SSE stream.
//
// Extracted from the former App.tsx monolith (redesign Stage 2); generalized to
// multi-session in Stage 4 (the ask carries its own sessionID, so abort targets
// that session, not a single global one).
import { createContext, useCallback, useContext, useRef, useState } from "react"
import type { ReactNode } from "react"
import type { OpenCodeEvent, PermissionAsk, ReplyKind } from "../lib/opencode"
import { useConnection, useOpenCodeEvents } from "./ConnectionContext"
import { useSessions } from "./SessionsContext"

interface PermissionValue {
  ask: PermissionAsk | null
  reply: (kind: ReplyKind) => Promise<void>
  abort: () => Promise<void>
}

const Ctx = createContext<PermissionValue | null>(null)

export function usePermission(): PermissionValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("usePermission must be used within a PermissionProvider")
  return v
}

export function PermissionProvider({ children }: { children: ReactNode }) {
  const { clientRef, setStatus } = useConnection()
  const { hasSession, setBusy } = useSessions()
  // A QUEUE, not a single ask: with multiple sessions (chat + code) two asks can
  // be outstanding at once. A single slot would let the second overwrite the
  // first, leaving the earlier session's request unanswerable (never replied or
  // aborted). We surface the head of the queue and advance as each is resolved.
  const [queue, setQueue] = useState<PermissionAsk[]>([])
  const ask = queue[0] ?? null
  // Ids the SERVER has confirmed resolved (seen on the permission.replied stream).
  // Lets a failed reply/abort POST tell a transient failure (server never applied
  // it → re-surface) from a lost-ACK (server DID apply it → do NOT re-surface, or
  // we pin an already-answered zombie). See reply()/abort() below.
  const repliedIds = useRef<Set<string>>(new Set())

  useOpenCodeEvents((e: OpenCodeEvent) => {
    const p = e.properties ?? {}
    const sid = p.sessionID ?? p.info?.sessionID ?? p.part?.sessionID
    switch (e.type) {
      case "permission.asked":
      case "permission.v2.asked":
        // Surface an ask from ANY of our sessions (chat or code), even one whose
        // tab isn't active — it blocks that session's agent loop indefinitely.
        if (sid && hasSession(sid)) {
          const a = p as PermissionAsk
          setQueue((q) => (q.some((x) => x.id === a.id) ? q : [...q, a]))
        }
        break
      case "permission.replied":
      case "permission.v2.replied": {
        // Answered elsewhere (or by us) → record it resolved + remove from the queue.
        const rid = p.requestID ?? p.id
        if (rid) repliedIds.current.add(rid)
        setQueue((q) => q.filter((x) => x.id !== rid))
        break
      }
    }
  })

  // Re-surface an optimistically-removed ask after a FAILED POST, but ONLY when it
  // is genuinely still pending: (1) we did NOT see permission.replied for it (a
  // lost-ACK means the server already applied it — re-surfacing would pin an
  // already-answered zombie that masks newer asks) AND (2) its session still exists
  // (a gone/GC'd session 404s forever — an unclearable stuck ask). Otherwise the
  // optimistic remove already left it correctly cleared. A genuinely-transient
  // failure (server never applied it → its agent loop is still paused) DOES
  // re-surface, so the session never wedges without a reply/abort control.
  const requeueIfPending = useCallback(
    (cur: PermissionAsk) => {
      if (repliedIds.current.has(cur.id) || !hasSession(cur.sessionID)) return false
      setQueue((q) => (q.some((x) => x.id === cur.id) ? q : [cur, ...q]))
      return true
    },
    [hasSession],
  )

  const reply = useCallback(
    async (kind: ReplyKind) => {
      const client = clientRef.current
      const cur = queue[0]
      if (!client || !cur) return
      setQueue((q) => q.filter((x) => x.id !== cur.id)) // optimistically advance to the next ask
      try {
        await client.replyPermission(cur.id, kind)
      } catch (err) {
        setStatus(`reply failed: ${err}`)
        requeueIfPending(cur)
      }
    },
    [queue, clientRef, setStatus, requeueIfPending],
  )

  const abort = useCallback(async () => {
    const client = clientRef.current
    const cur = queue[0]
    if (!cur) return
    setQueue((q) => q.filter((x) => x.id !== cur.id))
    if (cur.sessionID) setBusy(cur.sessionID, false)
    // Unlike reply, abort does NOT re-surface the ask on a failed POST. Aborting a
    // session resolves its pending permission WITHOUT a permission.replied event
    // (the server cancels the fiber + silently deletes the pending permission), so
    // repliedIds can never detect an abort lost-ACK — re-surfacing would risk a
    // zombie ask for an already-aborted session that masks a live cross-session ask.
    // abort already cleared busy above, so a failed abort leaves the composer usable
    // (no hard wedge); a genuinely-undelivered abort is a rare, milder residual.
    if (client && cur.sessionID) await client.abort(cur.sessionID).catch((err) => setStatus(`abort failed: ${err}`))
  }, [queue, clientRef, setBusy, setStatus])

  const value: PermissionValue = { ask, reply, abort }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
