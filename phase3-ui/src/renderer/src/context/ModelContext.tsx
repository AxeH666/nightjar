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

// Recovery offers carry the sessionId of the FAILING session, so the retry
// resends into that session — not always the chat slot (Bugbot: a code-session
// failure was being retried in chat).
interface FallbackOffer {
  text: string
  sessionId: string
}
interface RateLimitOffer {
  text: string
  provider: string
  sessionId: string
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
  // Given a session.error on `sessionId`, set the appropriate non-silent recovery offer (or none).
  handleSessionError: (err: any, lastText: string, sessionId: string) => void
}

const Ctx = createContext<ModelValue | null>(null)

export function useModel(): ModelValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useModel must be used within a ModelProvider")
  return v
}

export function ModelProvider({ children }: { children: ReactNode }) {
  const [choices, setChoices] = useState<ModelChoice[]>([LOCAL_MODEL])
  const [activeModel, setActiveModel] = useState<string>(LOCAL_MODEL.id)
  const [showKeys, setShowKeys] = useState(false)
  const [fallbackOffer, setFallbackOffer] = useState<FallbackOffer | null>(null) // last prompt + its session, if a cloud send failed
  const [rateLimitOffer, setRateLimitOffer] = useState<RateLimitOffer | null>(null)

  // Mirrors so handleSessionError (called from the SSE listener in SessionsContext)
  // reads current values without being a stale closure or a resubscribe trigger.
  const activeModelRef = useRef<string>(LOCAL_MODEL.id)
  const choicesRef = useRef<ModelChoice[]>([LOCAL_MODEL])
  const openRouterReadyRef = useRef<boolean>(false)

  const loadModels = useCallback(async () => {
    const providers = (await byok.list()) as Awaited<ReturnType<typeof byok.list>>
    openRouterReadyRef.current = openRouterConfigured(providers)
    const next = modelChoices(providers)
    setChoices(next)
    // if the active model's provider key was removed, fall back to local
    setActiveModel((cur) => (next.some((c) => c.id === cur) ? cur : LOCAL_MODEL.id))
  }, [])
  useEffect(() => {
    loadModels()
  }, [loadModels])

  const activeChoice = choices.find((c) => c.id === activeModel) ?? LOCAL_MODEL
  useEffect(() => {
    activeModelRef.current = activeModel
  }, [activeModel])
  useEffect(() => {
    choicesRef.current = choices
  }, [choices])

  const handleSessionError = useCallback((err: any, lastText: string, sessionId: string) => {
    // Graceful cloud fallback: a cloud model failing (bad/expired key, rate
    // limit, provider down) should offer local, not silently die. But NOT every
    // session.error is the cloud provider's fault — a user abort or a local
    // tool/MCP failure isn't, and offering "the cloud model failed" for those is
    // misleading. Skip those.
    const name: string | undefined = err?.name
    const notProviderFailure = name === "MessageAbortedError" || name === "MCPFailed"
    const activeM = activeModelRef.current
    if (!isLocalModel(activeM) && lastText && !notProviderFailure) {
      // Rate-limit (429) on a paid cloud provider + OpenRouter configured → offer
      // a switch to a free OpenRouter model (never silent). Otherwise fall back to
      // the local-retry offer. Either way, remember WHICH session failed.
      if (isRateLimitError(err) && openRouterReadyRef.current && activeM !== OPENROUTER_FREE_CHOICE.id) {
        setRateLimitOffer({ text: lastText, provider: providerNameOf(activeM, choicesRef.current), sessionId })
      } else {
        setFallbackOffer({ text: lastText, sessionId })
      }
    }
  }, [])

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
