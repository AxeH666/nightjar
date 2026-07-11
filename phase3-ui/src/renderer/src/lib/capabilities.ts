// Renderer-side client for per-capability Online/Offline + provider preferences.
// Talks to the main process over the preload bridge. No secrets cross this line —
// only {mode, providerId, modelId}. The main process is the source of truth and
// (in later PRs) applies the choice to the engine; this is a thin typed accessor.

export type CapabilityId = "chat" | "image" | "research" | "vision" | "browser"
export type CapabilityMode = "offline" | "online"

export interface CapabilityPref {
  mode: CapabilityMode
  providerId?: string // BYOK provider id when mode === "online"
  modelId?: string // model id within that provider (may contain "/")
}

interface CapabilitiesBridge {
  list(): Promise<Record<string, CapabilityPref>>
  set(id: CapabilityId, pref: CapabilityPref): Promise<CapabilityPref>
}

function bridge(): CapabilitiesBridge | null {
  return (window as unknown as { nightjar?: { capabilities?: CapabilitiesBridge } }).nightjar?.capabilities ?? null
}

export const capabilities = {
  // Full prefs map (every capability present, unset ones offline). Empty object when
  // the bridge is absent (e.g. running the renderer outside the desktop app).
  async list(): Promise<Record<string, CapabilityPref>> {
    return (await bridge()?.list()) ?? {}
  },
  // Persist a capability's choice. Best-effort when the bridge is absent.
  async set(id: CapabilityId, pref: CapabilityPref): Promise<void> {
    await bridge()?.set(id, pref)
  },
}

// Map a chat "providerID/modelID" string (as used by the model switcher) to a
// capability pref, and back. Chat's offline backend is the local Qwen model, so a
// local id ⇒ {mode:"offline"}. Splits on the FIRST "/" only (mirrors promptAsync),
// so an OpenRouter "meta-llama/…:free" model id keeps its inner slashes.
export function chatModelToPref(modelId: string, isLocal: boolean): CapabilityPref {
  if (isLocal) return { mode: "offline" }
  const slash = modelId.indexOf("/")
  const providerId = slash >= 0 ? modelId.slice(0, slash) : modelId
  const rest = slash >= 0 ? modelId.slice(slash + 1) : ""
  return { mode: "online", providerId, modelId: rest }
}

// The persisted online chat choice as a "providerID/modelID" id, or null when the
// pref is offline / malformed (caller falls back to the local default).
export function prefToChatModel(pref: CapabilityPref | undefined): string | null {
  if (pref?.mode === "online" && pref.providerId && pref.modelId) return `${pref.providerId}/${pref.modelId}`
  return null
}
