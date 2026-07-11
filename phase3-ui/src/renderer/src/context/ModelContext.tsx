// ModelContext — BYOK model choices, the active model (GLOBAL, applies to
// whatever mode/session is active), the manage-keys modal flag, and the two
// non-silent recovery offers (cloud→local fallback, 429→OpenRouter switch).
//
// Owns handleSessionError, which only DECIDES which offer to surface — it never
// re-sends. The actions that re-send (fallbackToLocal / acceptOpenRouterSwitch)
// live in SessionsContext, which already depends on this context, so the
// dependency stays one-way (Sessions → Model) with no cycle.
//
// Extracted from the former App.tsx monolith (redesign Stage 2), verbatim.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
  byok,
  modelChoices,
  isLocalModel,
  LOCAL_MODEL,
  openRouterConfigured,
  isRateLimitError,
  providerNameOf,
  OPENROUTER_FREE_CHOICE,
  type ModelChoice,
} from "../lib/byok"
import { capabilities, chatModelToPref, prefToChatModel, resolveActiveModel } from "../lib/capabilities"

// Recovery offers carry the FAILING session's id AND its slot, so the retry
// resends into that conversation — not always the chat slot (Bugbot #2), and
// still works if a reconnect replaced the session id in the meantime: the retry
// resolves via the slot's CURRENT session (Bugbot #1). `slot` is typed loosely
// (string) to avoid a ModelContext→SessionsContext import cycle.
// What kind of send failed, so the retry re-dispatches correctly (NJ-9): a "chat"
// retry uses the plain send path; an "image" retry MUST go back through
// createImage() so it re-wraps the generate_image directive (a plain resend of the
// raw prompt would just chat about it instead of regenerating).
export type SendKind = "chat" | "image"
interface FallbackOffer {
  text: string
  kind: SendKind
  sessionId: string
  slot: string | null
}
interface RateLimitOffer {
  text: string
  provider: string
  kind: SendKind
  sessionId: string
  slot: string | null
}

interface ModelValue {
  choices: ModelChoice[]
  activeModel: string
  setActiveModel: (id: string) => void
  activeChoice: ModelChoice
  showKeys: boolean
  setShowKeys: (v: boolean) => void
  fallbackOffer: FallbackOffer | null
  setFallbackOffer: (v: FallbackOffer | null) => void
  rateLimitOffer: RateLimitOffer | null
  setRateLimitOffer: (v: RateLimitOffer | null) => void
  loadModels: () => Promise<void>
  // Given a session.error on `sessionId` (in `slot`), set the appropriate non-silent
  // recovery offer (or none). `kind` = what failed (chat|image, so the retry
  // re-dispatches correctly). `sentModel` = the model the FAILING send actually used
  // (B4: decide recovery on that, not the current global model the user may have
  // since switched).
  handleSessionError: (err: any, lastText: string, kind: SendKind, sentModel: string, sessionId: string, slot: string | null) => void
}

const Ctx = createContext<ModelValue | null>(null)

export function useModel(): ModelValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useModel must be used within a ModelProvider")
  return v
}

export function ModelProvider({ children }: { children: ReactNode }) {
  const [choices, setChoices] = useState<ModelChoice[]>([LOCAL_MODEL])
  const [activeModel, setActiveModelState] = useState<string>(LOCAL_MODEL.id)
  const [showKeys, setShowKeys] = useState(false)
  const [fallbackOffer, setFallbackOffer] = useState<FallbackOffer | null>(null) // last prompt + its session, if a cloud send failed
  const [rateLimitOffer, setRateLimitOffer] = useState<RateLimitOffer | null>(null)

  // Mirrors so handleSessionError (called from the SSE listener in SessionsContext)
  // reads current values without being a stale closure or a resubscribe trigger.
  // (The failing send's OWN model now arrives as a param — B4 — so no activeModel
  // mirror is needed here.)
  const choicesRef = useRef<ModelChoice[]>([LOCAL_MODEL])
  const openRouterReadyRef = useRef<boolean>(false)
  const restoredRef = useRef(false) // first loadModels restores the persisted chat choice exactly once
  const userSelectedRef = useRef(false) // the user (or a recovery action) has explicitly picked a model this session

  // Persist every explicit chat model change so the choice survives an app restart
  // (nothing per-capability was persisted before). Recovery switches
  // (fallbackToLocal / acceptOpenRouterSwitch in SessionsContext) route through here
  // too — persisting them is correct, since the user accepted the switch. Fire-and-
  // forget: a store failure must never block the in-memory model change. Setting
  // userSelectedRef here is what lets a slow first-load restore know NOT to clobber a
  // switcher change the user made while byok.list/capabilities.list were in flight.
  const setActiveModel = useCallback((id: string) => {
    userSelectedRef.current = true
    setActiveModelState(id)
    capabilities.set("chat", chatModelToPref(id, isLocalModel(id))).catch(() => {})
  }, [])

  const loadModels = useCallback(async () => {
    const providers = (await byok.list()) as Awaited<ReturnType<typeof byok.list>>
    openRouterReadyRef.current = openRouterConfigured(providers)
    const next = modelChoices(providers)
    setChoices(next)
    // First load restores the persisted explicit chat choice (survives restart);
    // later loads (a key add/remove) only heal a now-invalid selection back to local.
    let restore: string | null = null
    if (!restoredRef.current) {
      restoredRef.current = true
      try {
        restore = prefToChatModel((await capabilities.list()).chat)
      } catch {
        /* store unavailable → keep whatever's active (local by default) */
      }
    }
    // Decide against the LATEST committed state via the functional updater: restore
    // applies only if the user hasn't picked during this load (race, Bugbot #1); an
    // unavailable choice heals to local and flags a persist (Bugbot #2). The persist
    // runs OUTSIDE the updater to keep the reducer pure.
    let healToOffline = false
    setActiveModelState((cur) => {
      const { resolved, healToOffline: heal } = resolveActiveModel({
        availableIds: next.map((c) => c.id),
        current: cur,
        localId: LOCAL_MODEL.id,
        restore,
        userSelected: userSelectedRef.current,
      })
      healToOffline = heal
      return resolved
    })
    // Involuntary heal (the chosen cloud model's key was removed) → record offline so
    // re-adding the key later does NOT silently restore cloud. Idempotent; a user's
    // own pick already persisted via setActiveModel, so this only fires for the heal.
    if (healToOffline) capabilities.set("chat", { mode: "offline" }).catch(() => {})
  }, [])
  useEffect(() => {
    loadModels()
  }, [loadModels])

  const activeChoice = choices.find((c) => c.id === activeModel) ?? LOCAL_MODEL
  useEffect(() => {
    choicesRef.current = choices
  }, [choices])

  const handleSessionError = useCallback(
    (err: any, lastText: string, kind: SendKind, sentModel: string, sessionId: string, slot: string | null) => {
      // Graceful cloud fallback: a cloud model failing (bad/expired key, rate
      // limit, provider down) should offer local, not silently die. But NOT every
      // session.error is the cloud provider's fault — a user abort or a local
      // tool/MCP failure isn't, and offering "the cloud model failed" for those is
      // misleading. Skip those.
      const name: string | undefined = err?.name
      const notProviderFailure = name === "MessageAbortedError" || name === "MCPFailed"
      // B4: judge by the model the FAILING send used (sentModel), not the current
      // global active model — the user may have switched models mid-turn, which
      // would otherwise suppress (or misattribute) the recovery offer.
      if (!isLocalModel(sentModel) && lastText && !notProviderFailure) {
        // Rate-limit (429) on a paid cloud provider + OpenRouter configured → offer
        // a switch to a free OpenRouter model (never silent). Otherwise fall back to
        // the local-retry offer. Either way, remember WHICH session + KIND failed.
        if (isRateLimitError(err) && openRouterReadyRef.current && sentModel !== OPENROUTER_FREE_CHOICE.id) {
          setRateLimitOffer({ text: lastText, provider: providerNameOf(sentModel, choicesRef.current), kind, sessionId, slot })
        } else {
          setFallbackOffer({ text: lastText, kind, sessionId, slot })
        }
      }
    },
    [],
  )

  const value: ModelValue = {
    choices,
    activeModel,
    setActiveModel,
    activeChoice,
    showKeys,
    setShowKeys,
    fallbackOffer,
    setFallbackOffer,
    rateLimitOffer,
    setRateLimitOffer,
    loadModels,
    handleSessionError,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
