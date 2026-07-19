// ConnectionContext — owns the OpenCode client, the ONE instance-wide SSE
// subscription (GET /event) + a listener fan-out, the session id, connection
// status, sidecar-service status, and the connect/retry loop. Every other
// context registers a slice of the old monolithic handleEvent via
// useOpenCodeEvents and filters by sessionID itself.
//
// Extracted from the former App.tsx monolith (redesign Stage 2). Behavior is
// preserved verbatim; Stage 3 generalizes the reconnect (NJ-4).
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { MutableRefObject, ReactNode } from "react"
import { OpenCodeClient } from "../lib/opencode"
import type { AgentInfo, OpenCodeEvent } from "../lib/opencode"
import type { ServiceStatus } from "../components/HealthStrip"
import { connectingHint } from "../lib/connectionStatus"

// The sole renderer↔main bridge surface (preload contextBridge). Declared here
// (globally) so every context/component sees it.
declare global {
  interface Window {
    nightjar?: {
      getConfig(): Promise<{ opencodeUrl: string; sideChannelUrl?: string; isWSL?: boolean }>
      getStatus?(): Promise<ServiceStatus[]>
      onStatus?(cb: (s: ServiceStatus[]) => void): () => void
      restartService?(name: string): Promise<void>
      serviceLogs?(name: string): Promise<string[]>
      readAudio?(path: string): Promise<ArrayBuffer>
      byok?: {
        keyStorageMode(): Promise<string>
        list(): Promise<unknown[]>
        set(providerId: string, key: string): Promise<void>
        remove(providerId: string): Promise<void>
      }
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface ConnectionValue {
  clientRef: MutableRefObject<OpenCodeClient | null>
  sessionRef: MutableRefObject<string> // for event-time reads (the `mine` filter)
  sessionID: string // for render-time consumers (e.g. ArtifactPanel)
  agents: AgentInfo[]
  status: string
  connected: boolean // true once the SSE stream is live; false while (re)connecting — drives the manual Reconnect affordance
  setStatus: (s: string) => void
  services: ServiceStatus[]
  wsUrl: string
  reconnect: () => void // recreate session + resubscribe (BYOK restart; NJ-4 in Stage 3)
  subscribeEvents: (fn: (e: OpenCodeEvent) => void) => () => void
}

const Ctx = createContext<ConnectionValue | null>(null)

export function useConnection(): ConnectionValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useConnection must be used within a ConnectionProvider")
  return v
}

// Register a handler on the instance-wide SSE fan-out. The handler may be
// unstable (recreated each render) — we call through a ref so the registration
// stays stable and never thrashes the single underlying subscription.
export function useOpenCodeEvents(handler: (e: OpenCodeEvent) => void): void {
  const { subscribeEvents } = useConnection()
  const ref = useRef(handler)
  useLayoutEffect(() => {
    ref.current = handler
  })
  useEffect(() => subscribeEvents((e) => ref.current(e)), [subscribeEvents])
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [status, setStatus] = useState<string>("connecting…")
  const [connected, setConnected] = useState<boolean>(false)
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [wsUrl, setWsUrl] = useState<string>("ws://127.0.0.1:8765")
  const [sessionID, setSessionID] = useState<string>("")
  // Bump to force the connect effect to re-run (recreate session + resubscribe).
  // Two callers now feed it (NJ-4): a BYOK key change (restarts opencode-serve,
  // killing the SSE stream + invalidating the session id) AND any SSE-stream
  // close (crash-restart included). Either way, without a reconnect chat stays
  // broken (dead stream, stale session) until a full reload.
  const [reconnectNonce, setReconnectNonce] = useState(0)

  const clientRef = useRef<OpenCodeClient | null>(null)
  const sessionRef = useRef<string>("")
  const listenersRef = useRef<Set<(e: OpenCodeEvent) => void>>(new Set())
  // Mirror `services` into a ref so the long-lived connect-loop effect can read the LATEST
  // supervisor status when composing its status message, without re-subscribing (P2-8).
  const servicesRef = useRef<ServiceStatus[]>([])

  const subscribeEvents = useCallback((fn: (e: OpenCodeEvent) => void) => {
    listenersRef.current.add(fn)
    return () => {
      listenersRef.current.delete(fn)
    }
  }, [])

  const reconnect = useCallback(() => setReconnectNonce((n) => n + 1), [])

  // ---- sidecar status strip (from the Electron supervisor) ----
  useEffect(() => {
    let off: (() => void) | undefined
    window.nightjar?.getStatus?.().then(setServices).catch(() => {})
    off = window.nightjar?.onStatus?.(setServices)
    return () => off?.()
  }, [])

  // Keep servicesRef in sync so the connect loop reads the latest engine state (P2-8).
  useEffect(() => {
    servicesRef.current = services
  }, [services])

  // ---- connect (retry until OpenCode is reachable — the supervisor may still
  // be bringing it up, esp. during a cold model load) ----
  useEffect(() => {
    const ac = new AbortController()
    setConnected(false) // a fresh (re)connect attempt begins — no live stream yet
    ;(async () => {
      const cfg = (await window.nightjar?.getConfig?.()) ?? {
        opencodeUrl: (import.meta as any).env?.VITE_OPENCODE_URL || "http://127.0.0.1:4096",
        sideChannelUrl: (import.meta as any).env?.VITE_NIGHTJAR_WS_URL || "ws://127.0.0.1:8765",
      }
      if (cfg.sideChannelUrl) setWsUrl(cfg.sideChannelUrl)
      const client = new OpenCodeClient(cfg.opencodeUrl)
      clientRef.current = client
      for (let attempt = 0; !ac.signal.aborted; attempt++) {
        try {
          const list = await client.listAgents()
          setAgents(list)
          const sid = await client.createSession("June session")
          // NJ-4 hardening (A): a reconnect fired mid-init (e.g. a BYOK key set during
          // a slow cold model load) aborts this run's signal. Bail before publishing
          // the session id, so a superseded run can't transiently flip primaryId to a
          // session it will never subscribe to (the newer run owns the connection).
          if (ac.signal.aborted) return
          sessionRef.current = sid
          setSessionID(sid) // triggers the per-session artifact reset in ArtifactContext
          // NB: do NOT mark connected / show "connected" here — createSession succeeding does
          // NOT mean the event bus is live. A half-open GET /event connect could still hang;
          // claiming connected now would unblock the composer + hide Reconnect AND print
          // "connected · …" over a dead stream (Bugbot). Both flip only from subscribe()'s
          // onOpen (stream truly established). Until then the "starting…" status stands.
          // One subscription; fan out every event to the registered listeners.
          const dispatch = (e: OpenCodeEvent) => listenersRef.current.forEach((l) => l(e))
          // NJ-4: on ANY stream termination — a clean close OR a crash — re-enter
          // this connect/retry loop instead of parking on a dead stream. This
          // covers the supervisor's crash→auto-restart of opencode-serve, not just
          // the BYOK-triggered restart (which already bumps reconnectNonce). A 1s
          // settle floor keeps a flapping engine from spinning us hot; the
          // aborted-guard prevents a reconnect fired after this effect is torn down
          // (unmount, or a concurrent BYOK reconnect) — so it never double-connects.
          const reconnectAfterClose = (reason: string) => {
            if (ac.signal.aborted) return
            setConnected(false) // stream dropped → surface the reconnecting state + manual affordance
            setStatus(reason)
            setTimeout(() => {
              if (!ac.signal.aborted) reconnect()
            }, 1000)
          }
          client
            .subscribe(dispatch, ac.signal, () => {
              // Stream is truly established → NOW we're connected: unblock the composer,
              // hide Reconnect, and only now print "connected · …". Guard on the run's
              // signal so a superseded run can't flip it.
              if (ac.signal.aborted) return
              setStatus(`connected · ${cfg.opencodeUrl}`)
              setConnected(true)
            })
            .then(() => reconnectAfterClose("stream closed — reconnecting…"))
            .catch((err) => reconnectAfterClose(`stream closed: ${err} — reconnecting…`))
          return
        } catch {
          // Cold start: opencode isn't listening until the local model finishes loading (up to a
          // minute on first launch) — the raw "Failed to fetch" read as a hard error and looked
          // broken. Show a calm, honest progress message; the loop keeps retrying every 2s and
          // connects the moment the engine is up. But don't loop the SAME optimistic message
          // forever (P2-8): once the supervisor marks the engine `failed`, or ~90s pass with no
          // connection, connectingHint() surfaces an honest state that points at the Services strip.
          const oc = servicesRef.current.find((s) => s.name === "opencode-serve")
          setStatus(connectingHint(attempt, oc?.state, oc?.detail))
          await sleep(2000)
        }
      }
    })()
    return () => ac.abort()
  }, [reconnectNonce])

  const value: ConnectionValue = {
    clientRef,
    sessionRef,
    sessionID,
    agents,
    status,
    connected,
    setStatus,
    services,
    wsUrl,
    reconnect,
    subscribeEvents,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
