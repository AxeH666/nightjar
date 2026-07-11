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

export interface CapabilityMeta {
  id: CapabilityId
  name: string
  onlineProviders: string[] // BYOK provider ids this capability's cloud path can route to
  offlineLabel: string // label for the local/offline backend
}

interface CapabilitiesBridge {
  catalog(): Promise<{ capabilities: CapabilityMeta[]; ui: string[] }>
  list(): Promise<Record<string, CapabilityPref>>
  set(id: CapabilityId, pref: CapabilityPref): Promise<CapabilityPref>
}

function bridge(): CapabilitiesBridge | null {
  return (window as unknown as { nightjar?: { capabilities?: CapabilitiesBridge } }).nightjar?.capabilities ?? null
}

export const capabilities = {
  // The capability catalog + which ids render as settings rows. Empty when the bridge
  // is absent (renderer outside the desktop app).
  async catalog(): Promise<{ capabilities: CapabilityMeta[]; ui: CapabilityId[] }> {
    const c = await bridge()?.catalog()
    return { capabilities: c?.capabilities ?? [], ui: (c?.ui ?? []) as CapabilityId[] }
  },
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

// The configured providers a capability may go Online with: its allowlist intersected
// with the providers that actually have a key, preserving allowlist order.
export function availableOnlineProviders(onlineProviders: string[], configuredIds: string[]): string[] {
  const configured = new Set(configuredIds)
  return onlineProviders.filter((id) => configured.has(id))
}

// When flipping a capability Online (or after a key change), keep the current provider
// if it's still available, otherwise fall back to the first available one (or undefined
// when none is configured — the UI then blocks Online).
export function nextOnlineProvider(current: string | undefined, available: string[]): string | undefined {
  if (current && available.includes(current)) return current
  return available[0]
}

// Pure decision for which chat model should be active after the model list (re)loads
// — extracted so the race/heal rules are unit-testable without React:
//  • `restore` (the persisted choice) applies ONLY when the user has NOT picked since
//    the load started (`userSelected` false). This prevents a slow byok.list /
//    capabilities.list resolving and clobbering a switcher change the user just made.
//  • a `wanted` model that is no longer available (its provider key was removed) heals
//    to local; `healToOffline` then signals the caller to PERSIST offline, so
//    re-adding the key later does not silently restore cloud (explicit-selection).
export function resolveActiveModel(args: {
  availableIds: string[]
  current: string
  localId: string
  restore: string | null
  userSelected: boolean
}): { resolved: string; healToOffline: boolean } {
  const { availableIds, current, localId, restore, userSelected } = args
  const wanted = !userSelected && restore ? restore : current
  const resolved = availableIds.includes(wanted) ? wanted : localId
  return { resolved, healToOffline: resolved === localId && wanted !== localId }
}
