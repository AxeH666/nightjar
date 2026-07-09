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
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import type { OpenCodeEvent, PermissionAsk, ReplyKind } from "../lib/opencode"
import { useConnection, useOpenCodeEvents } from "./ConnectionContext"
import { useSessions } from "./SessionsContext"

interface PermissionValue {
  ask: PermissionAsk | null
  reply: (kind: ReplyKind) => Promise<void>
  abort: () => Promise<void>
  // Abort a specific session — backs the persistent per-session Stop control (NJ-10),
  // so a session that's still running/paused (even with no ask shown) is always
  // interruptible. Keeps busy TRUE on a failed abort so Stop stays available.
  abortSession: (sessionID: string) => Promise<void>
}

const Ctx = createContext<PermissionValue | null>(null)

export function usePermission(): PermissionValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("usePermission must be used within a PermissionProvider")
  return v
}

export function PermissionProvider({ children }: { children: ReactNode }) {
  const { clientRef, setStatus } = useConnection()
  const { hasSession, setBusy, sessions } = useSessions()
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
          // Normalize sessionID to the resolved `sid` (the raw event may carry it
          // nested under info/part), so abortSession(cur.sessionID) and the prune
          // effect always see a valid id — never undefined.
          const a = { ...(p as PermissionAsk), sessionID: sid }
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

  // Abort a specific session — the persistent per-session Stop control (NJ-10) and
  // the PermissionPanel's Abort both funnel here (ONE path to verify, rule 6).
  // Cancels the session server-side and drops ALL its queued asks (an aborted
  // permission resolves with NO permission.replied event, so nothing else would
  // clear them, and re-surfacing would risk a zombie for an already-aborted session
  // masking a live cross-session ask). On a FAILED POST it deliberately leaves busy
  // TRUE, so the Stop control stays visible + re-clickable — busy now honestly means
  // "still running/paused server-side" rather than being cleared optimistically.
  const abortSession = useCallback(
    async (sessionID: string) => {
      if (!sessionID) return
      setQueue((q) => q.filter((x) => x.sessionID !== sessionID))
      const client = clientRef.current
      if (!client) return
      try {
        await client.abort(sessionID)
        setBusy(sessionID, false) // clear busy ONLY on a confirmed abort
      } catch (err) {
        setStatus(`abort failed: ${err}`) // leave busy TRUE → Stop stays (NJ-10)
      }
    },
    [clientRef, setBusy, setStatus],
  )

  // PermissionPanel's Abort button aborts the ASKING session via the shared path.
  const abort = useCallback(async () => {
    const cur = queue[0]
    if (cur?.sessionID) await abortSession(cur.sessionID)
  }, [queue, abortSession])

  // NJ-4 hardening (B): a reconnect / slot-switch replaces + GC's sessions, so a
  // queued ask for a now-gone session is a phantom (unanswerable — reply 404s and
  // requeueIfPending won't re-surface it). Drop such asks when the session registry
  // changes. Keyed on the live session set + hasSession (perSessionRefs), and
  // returns the SAME queue reference when nothing is stale — so it NEVER drops a
  // still-valid ask and never churns a render. (rule 1: only ever removes asks whose
  // session genuinely no longer exists.)
  useEffect(() => {
    setQueue((q) => {
      const next = q.filter((x) => hasSession(x.sessionID))
      return next.length === q.length ? q : next
    })
  }, [sessions, hasSession])

  const value: PermissionValue = { ask, reply, abort, abortSession }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
