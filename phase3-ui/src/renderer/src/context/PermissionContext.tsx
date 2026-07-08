// PermissionContext — the safety-critical approval flow. Owns the pending `ask`,
// the reply (once/always/reject), and the session abort escape hatch. Renders
// GLOBAL: a permission from ANY session must surface, above every other overlay,
// with no server-side timeout (an unanswered ask blocks the agent loop
// indefinitely — hence the mandatory abort).
//
// Innermost provider: consumes ConnectionContext (client + sessionRef) and
// ChatContext (setBusy, cleared on abort). Registers only the permission.* slice
// of the old handleEvent.
//
// Extracted from the former App.tsx monolith (redesign Stage 2), verbatim.
import { createContext, useCallback, useContext, useState } from "react"
import type { ReactNode } from "react"
import type { OpenCodeEvent, PermissionAsk, ReplyKind } from "../lib/opencode"
import { useConnection, useOpenCodeEvents } from "./ConnectionContext"
import { useChat } from "./ChatContext"

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
  const { clientRef, sessionRef, setStatus } = useConnection()
  const { setBusy } = useChat()
  const [ask, setAsk] = useState<PermissionAsk | null>(null)

  useOpenCodeEvents((e: OpenCodeEvent) => {
    const p = e.properties ?? {}
    const sid = p.sessionID ?? p.info?.sessionID ?? p.part?.sessionID
    const mine = sessionRef.current && sid === sessionRef.current
    switch (e.type) {
      case "permission.asked":
      case "permission.v2.asked":
        if (mine) setAsk(p as PermissionAsk)
        break
      case "permission.replied":
      case "permission.v2.replied":
        setAsk((cur) => (cur && cur.id === (p.requestID ?? p.id) ? null : cur))
        break
    }
  })

  const reply = useCallback(
    async (kind: ReplyKind) => {
      const client = clientRef.current
      if (!client || !ask) return
      const id = ask.id
      setAsk(null)
      await client.replyPermission(id, kind).catch((err) => setStatus(`reply failed: ${err}`))
    },
    [ask, clientRef, setStatus],
  )

  const abort = useCallback(async () => {
    const client = clientRef.current
    setAsk(null)
    setBusy(false)
    if (client && sessionRef.current) await client.abort(sessionRef.current).catch(() => {})
  }, [clientRef, sessionRef, setBusy])

  const value: PermissionValue = { ask, reply, abort }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
