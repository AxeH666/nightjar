// Headless unit test for the OpenRouter rate-limit-switch core logic (pure fns in
// lib/byok.ts — no window/electron needed at import). Run: bun test-openrouter.ts
import {
  isRateLimitError,
  openRouterConfigured,
  isOpenRouterModel,
  modelChoices,
  providerNameOf,
  OPENROUTER_FREE_CHOICE,
  LOCAL_MODEL,
  type ByokProviderStatus,
} from "./src/renderer/src/lib/byok"

let pass = 0,
  fail = 0
const check = (n: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${n}${extra ? " — " + extra : ""}`)
  ok ? pass++ : fail++
}

// --- isRateLimitError: the 429 heuristic ---
check("429 in message", isRateLimitError({ name: "Unknown", message: "AI_APICallError: 429 Too Many Requests" }))
check("bare '429' string", isRateLimitError("429"))
check("'rate limit exceeded'", isRateLimitError("rate limit exceeded"))
check("'rate-limit' hyphen", isRateLimitError({ message: "provider rate-limit hit" }))
check("'quota'", isRateLimitError({ message: "insufficient_quota for this key" }))
check("'usage limit'", isRateLimitError("You have exceeded your usage limit"))
check("auth error is NOT rate-limit", !isRateLimitError({ name: "ProviderAuthError", message: "invalid api key" }))
check("abort is NOT rate-limit", !isRateLimitError({ name: "MessageAbortedError" }))
check("null → false", !isRateLimitError(null))
check("random 4290 does not false-match", !isRateLimitError("code 4290 xyz"))

// --- openRouterConfigured ---
const withOR: ByokProviderStatus[] = [
  { id: "openai", name: "OpenAI", defaultModel: "gpt-4o", keyHint: "", hasKey: true },
  { id: "openrouter", name: "OpenRouter", defaultModel: "openai/gpt-4o", keyHint: "", hasKey: true },
]
const noOR: ByokProviderStatus[] = [{ id: "openai", name: "OpenAI", defaultModel: "gpt-4o", keyHint: "", hasKey: true }]
const orNoKey: ByokProviderStatus[] = [{ id: "openrouter", name: "OpenRouter", defaultModel: "x", keyHint: "", hasKey: false }]
check("openRouterConfigured true when key present", openRouterConfigured(withOR))
check("openRouterConfigured false when absent", !openRouterConfigured(noOR))
check("openRouterConfigured false when key not set", !openRouterConfigured(orNoKey))

// --- modelChoices surfaces the free OR model iff OR configured ---
const withORChoices = modelChoices(withOR)
check("free OR choice present when OR configured", withORChoices.some((c) => c.id === OPENROUTER_FREE_CHOICE.id))
check("free OR choice absent when OR not configured", !modelChoices(noOR).some((c) => c.id === OPENROUTER_FREE_CHOICE.id))
check("local model is always first", modelChoices(noOR)[0]?.id === LOCAL_MODEL.id)
check("no duplicate free OR choice", withORChoices.filter((c) => c.id === OPENROUTER_FREE_CHOICE.id).length === 1)

// --- helpers ---
check("isOpenRouterModel true for OR id", isOpenRouterModel(OPENROUTER_FREE_CHOICE.id))
check("isOpenRouterModel false for local", !isOpenRouterModel(LOCAL_MODEL.id))
check("providerNameOf resolves display name", providerNameOf("openai/gpt-4o", [
  { id: "openai/gpt-4o", label: "OpenAI", local: false, providerName: "OpenAI" },
]) === "OpenAI")
check("providerNameOf falls back to provider id", providerNameOf("anthropic/claude", []) === "anthropic")

console.log(`\n==== openrouter core: ${pass} passed, ${fail} failed ====`)
process.exit(fail > 0 ? 1 : 0)
