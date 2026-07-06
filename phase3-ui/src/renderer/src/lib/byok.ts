// Renderer-side BYOK client. Talks to the main process over the preload bridge;
// raw keys never live here — only masked status in, key text out (to main).

export interface ByokProviderStatus {
  id: string // opencode provider id (openai, anthropic, …)
  name: string // display name
  defaultModel: string // sensible model id for the switcher
  keyHint: string // input placeholder
  hasKey: boolean // a key is configured (encrypted) for this provider
}

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

interface NightjarByokBridge {
  secureAvailable(): Promise<boolean>
  list(): Promise<ByokProviderStatus[]>
  set(providerId: string, key: string): Promise<void>
  remove(providerId: string): Promise<void>
}

function bridge(): NightjarByokBridge | null {
  return (window as unknown as { nightjar?: { byok?: NightjarByokBridge } }).nightjar?.byok ?? null
}

export const byok = {
  async secureAvailable(): Promise<boolean> {
    return (await bridge()?.secureAvailable()) ?? false
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
// per cloud provider that has a key configured.
export function modelChoices(providers: ByokProviderStatus[]): ModelChoice[] {
  const cloud = providers
    .filter((p) => p.hasKey)
    .map<ModelChoice>((p) => ({
      id: `${p.id}/${p.defaultModel}`,
      label: `☁ ${p.name} · ${p.defaultModel}`,
      local: false,
      providerName: p.name,
    }))
  return [LOCAL_MODEL, ...cloud]
}

export function isLocalModel(modelId: string): boolean {
  return modelId.startsWith("llamacpp/")
}
