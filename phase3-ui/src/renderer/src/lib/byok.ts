// Renderer-side BYOK client. Talks to the main process over the preload bridge;
// raw keys never live here — only masked status in, key text out (to main).

export interface ByokProviderStatus {
  id: string // opencode provider id (openai, anthropic, …)
  name: string // display name
  defaultModel: string // sensible model id for the switcher
  keyHint: string // input placeholder
  hasKey: boolean // a key is configured (encrypted) for this provider
}

// How keys can be stored on this machine (mirrors the main-process type). Drives
// the settings UI's enable/disable + honest "encrypted vs test-only" messaging.
export type KeyStorageMode = "encrypted" | "insecure" | "unavailable"

// A model the user can pick. `local` marks the offline default.
export interface ModelChoice {
  id: string // "providerID/modelID" — the value sent to opencode per prompt
  label: string // friendly label
  local: boolean // true = runs on-device (Qwen3-4B); false = cloud (data leaves)
  providerName?: string // cloud provider display name (for the banner)
}

export const LOCAL_MODEL: ModelChoice = {
  id: "llamacpp/qwen3-4b-instruct-2507",
  label: "Local · Qwen3-4B (offline)",
  local: true,
}

// OpenRouter (already a BYOK provider) is the designated **rate-limit fallback**:
// when a paid cloud provider returns 429, we can switch to a *free* OpenRouter
// model to keep going. OpenRouter marks free models with a ":free" suffix. The
// model id is "providerID/modelID"; promptAsync() splits on the FIRST "/", so
// providerID="openrouter" and modelID keeps its own "meta-llama/…:free" slashes.
// Kept as one constant so the switcher and the 429-switch agree; update the pair
// if OpenRouter's free catalog changes.
export const OPENROUTER_PROVIDER_ID = "openrouter"
const OPENROUTER_FREE_MODEL_ID = "meta-llama/llama-3.3-70b-instruct:free"
export const OPENROUTER_FREE_CHOICE: ModelChoice = {
  id: `${OPENROUTER_PROVIDER_ID}/${OPENROUTER_FREE_MODEL_ID}`,
  label: "☁ OpenRouter · Llama-3.3-70B (free)",
  local: false,
  providerName: "OpenRouter",
}

// Is OpenRouter configured (key present) so a free-model fallback is available?
export function openRouterConfigured(providers: ByokProviderStatus[]): boolean {
  return providers.some((p) => p.id === OPENROUTER_PROVIDER_ID && p.hasKey)
}

export function isOpenRouterModel(modelId: string): boolean {
  return modelId.startsWith(`${OPENROUTER_PROVIDER_ID}/`)
}

// Heuristic: does a session.error look like a provider **rate-limit (HTTP 429)**?
// OpenCode surfaces provider-call failures as a NamedError; a 429 arrives as an
// "Unknown"-wrapped AI-SDK error whose name/message carries the status or "rate
// limit"/"quota" text. Accepts the error object or a bare string.
export function isRateLimitError(err: { name?: string; message?: string } | string | null | undefined): boolean {
  if (!err) return false
  const text = typeof err === "string" ? err : `${err.name ?? ""} ${err.message ?? ""}`
  return /\b429\b|rate[ _-]?limit|too many requests|quota|usage limit|insufficient_quota/i.test(text)
}

// Friendly provider name for a "providerID/modelID" choice (for the switch banner).
export function providerNameOf(modelId: string, choices: ModelChoice[]): string {
  return choices.find((c) => c.id === modelId)?.providerName ?? modelId.split("/")[0]
}

interface NightjarByokBridge {
  keyStorageMode(): Promise<KeyStorageMode>
  list(): Promise<ByokProviderStatus[]>
  set(providerId: string, key: string): Promise<void>
  remove(providerId: string): Promise<void>
}

function bridge(): NightjarByokBridge | null {
  return (window as unknown as { nightjar?: { byok?: NightjarByokBridge } }).nightjar?.byok ?? null
}

export const byok = {
  async keyStorageMode(): Promise<KeyStorageMode> {
    return (await bridge()?.keyStorageMode()) ?? "unavailable"
  },
  async list(): Promise<ByokProviderStatus[]> {
    return (await bridge()?.list()) ?? []
  },
  async set(providerId: string, key: string): Promise<void> {
    const b = bridge()
    if (!b) throw new Error("BYOK bridge unavailable (not running in the desktop app)")
    await b.set(providerId, key)
  },
  async remove(providerId: string): Promise<void> {
    await bridge()?.remove(providerId)
  },
}

// Build the model switcher's choices: the local default first, then one entry
// per cloud provider that has a key configured. When OpenRouter is configured we
// also surface its free model (the 429 fallback target) as an extra choice.
export function modelChoices(providers: ByokProviderStatus[]): ModelChoice[] {
  const cloud = providers
    .filter((p) => p.hasKey)
    .map<ModelChoice>((p) => ({
      id: `${p.id}/${p.defaultModel}`,
      label: `☁ ${p.name} · ${p.defaultModel}`,
      local: false,
      providerName: p.name,
    }))
  const out = [LOCAL_MODEL, ...cloud]
  if (openRouterConfigured(providers) && !out.some((c) => c.id === OPENROUTER_FREE_CHOICE.id)) {
    out.push(OPENROUTER_FREE_CHOICE)
  }
  return out
}

export function isLocalModel(modelId: string): boolean {
  return modelId.startsWith("llamacpp/")
}
