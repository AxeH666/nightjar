// Pure logic for the ONE global Local/Cloud switch (Tasks 1 + 2).
//
// The global toggle is a UI fan-out over the EXISTING per-capability prefs — it does not
// replace them. "Local" means every capability offline + chat on the local model; "Cloud
// (provider X)" means every capability X *can* serve is online:X, chat is X's default
// model, and everything X can't serve stays offline (honestly — see capabilitySupport).
//
// Framework-free and side-effect-free so every rule here is unit-tested without React,
// Electron, or the store. The store writes happen in the component (PR6) using the plan
// these functions return.

export type CapabilityId = "chat" | "image" | "research" | "vision" | "browser"
export type CapabilityMode = "offline" | "online"

export interface CapabilityPref {
  mode: CapabilityMode
  providerId?: string
  modelId?: string
}

// Minimal shape we need from the capability catalog (main's CapabilityMeta is wider).
export interface CapabilitySupportMeta {
  id: CapabilityId
  onlineProviders: string[] // provider ids this capability's cloud path can route to
}

// Minimal shape we need from a BYOK provider (byok.ts ByokProvider is wider).
export interface ProviderModelMeta {
  id: string
  defaultModel: string
}

// The capabilities that have their OWN pref + resolver. `websearch` is deliberately NOT
// here: it inherits the `research` backend (no NIGHTJAR_WEBSEARCH_PROVIDER env, by
// design — that's what kept Task 3 cheap), so the toggle governs it transitively through
// `research`, not as a separate pref.
export const TOGGLE_CAPABILITIES: CapabilityId[] = ["chat", "image", "research", "vision", "browser"]

// Non-chat capabilities the settings summary + bulk plan iterate over (chat is handled
// separately: it's the model switcher, not a capability-pref row).
export const NON_CHAT_CAPABILITIES: CapabilityId[] = ["image", "research", "vision", "browser"]

export type GlobalMode =
  | { kind: "local" }
  | { kind: "cloud"; providerId: string }
  | { kind: "mixed" } // prefs don't correspond to a single clean Local or Cloud(one provider) state

// Does provider `providerId` support capability `capId`? Chat is universal (every provider
// can chat); every other capability is supported iff the provider is in its onlineProviders
// allowlist. `websearch` maps onto `research` (it has no allowlist of its own).
export function capabilitySupport(
  capId: CapabilityId | "websearch",
  providerId: string,
  catalog: CapabilitySupportMeta[],
): boolean {
  if (capId === "chat") return true
  const key = capId === "websearch" ? "research" : capId
  const meta = catalog.find((c) => c.id === key)
  return !!meta && meta.onlineProviders.includes(providerId)
}

// The capabilities a provider CAN and CANNOT serve — for the upfront settings summary
// ("openai — chat, image, vision, research, browser ✓" vs "groq — chat, research ✓ ·
// image/vision/browser: not supported"). `websearch` is folded into `research` so we don't
// double-list it. Order follows TOGGLE_CAPABILITIES for a stable display.
export function providerCapabilitySummary(
  providerId: string,
  catalog: CapabilitySupportMeta[],
): { supported: CapabilityId[]; unsupported: CapabilityId[] } {
  const supported: CapabilityId[] = []
  const unsupported: CapabilityId[] = []
  for (const capId of TOGGLE_CAPABILITIES) {
    ;(capabilitySupport(capId, providerId, catalog) ? supported : unsupported).push(capId)
  }
  return { supported, unsupported }
}

// Derive the toggle's displayed state FROM the persisted prefs (the store is the source of
// truth; the toggle is a view over it). Rules:
//   • all non-chat caps offline AND chat local            → Local
//   • all non-chat caps online with the SAME provider P
//     AND chat online with P                              → Cloud(P)
//   • a provider that is Cloud but legitimately can't do
//     some caps (so those stay offline) still reads as
//     Cloud(P), as long as every cap it CAN do is online:P
//     and none is online with a DIFFERENT provider        → Cloud(P)
//   • anything else                                       → Mixed
//
// chatIsLocal / chatProviderId describe the header model-switcher state (chat has no
// capability-pref row). Passing them in keeps this pure.
export function deriveGlobalMode(args: {
  prefs: Record<string, CapabilityPref | undefined>
  chatIsLocal: boolean
  chatProviderId: string | null
  catalog: CapabilitySupportMeta[]
}): GlobalMode {
  const { prefs, chatIsLocal, chatProviderId, catalog } = args
  const caps = NON_CHAT_CAPABILITIES.map((id) => ({ id, pref: prefs[id] ?? { mode: "offline" as const } }))

  const allOffline = caps.every((c) => c.pref.mode === "offline")
  if (allOffline && chatIsLocal) return { kind: "local" }

  // Collect the distinct providers actually selected across chat + online caps.
  const providers = new Set<string>()
  if (!chatIsLocal && chatProviderId) providers.add(chatProviderId)
  for (const c of caps) {
    if (c.pref.mode === "online") {
      if (!c.pref.providerId) return { kind: "mixed" } // online-without-provider is incoherent
      providers.add(c.pref.providerId)
    }
  }
  // Exactly one provider in play, and chat is on it → candidate Cloud(P).
  if (providers.size === 1 && !chatIsLocal && chatProviderId) {
    const p = chatProviderId
    // Every cap P can serve must be online:P; every cap it can't must be offline. That is
    // exactly the state applyGlobalMode(cloud, P) produces, so it round-trips.
    const clean = caps.every((c) =>
      capabilitySupport(c.id, p, catalog)
        ? c.pref.mode === "online" && c.pref.providerId === p
        : c.pref.mode === "offline",
    )
    if (clean) return { kind: "cloud", providerId: p }
  }
  return { kind: "mixed" }
}

// The concrete write-plan for switching the whole app to a target mode. Returns the new
// per-capability prefs AND the chat model id to activate — the component applies them
// (setBulk + setActiveModel). Pure: no store, no IPC.
//
//   Local → every cap offline, chat = localModelId.
//   Cloud(P) → each cap P supports = online:P; each cap it doesn't = offline (honest, no
//              fabricated cloud route); chat = "P/<P.defaultModel>".
export function applyGlobalMode(args: {
  target: { kind: "local" } | { kind: "cloud"; providerId: string }
  catalog: CapabilitySupportMeta[]
  providers: ProviderModelMeta[]
  localModelId: string
}): { prefs: Record<CapabilityId, CapabilityPref>; chatModelId: string; unsupported: CapabilityId[] } {
  const { target, catalog, providers, localModelId } = args
  const prefs = {} as Record<CapabilityId, CapabilityPref>

  if (target.kind === "local") {
    for (const id of NON_CHAT_CAPABILITIES) prefs[id] = { mode: "offline" }
    return { prefs, chatModelId: localModelId, unsupported: [] }
  }

  const p = target.providerId
  const unsupported: CapabilityId[] = []
  for (const id of NON_CHAT_CAPABILITIES) {
    if (capabilitySupport(id, p, catalog)) {
      prefs[id] = { mode: "online", providerId: p }
    } else {
      prefs[id] = { mode: "offline" } // never claim a cloud route the provider can't serve
      unsupported.push(id)
    }
  }
  const provider = providers.find((x) => x.id === p)
  const chatModelId = provider ? `${p}/${provider.defaultModel}` : localModelId
  return { prefs, chatModelId, unsupported }
}

// Can an image actually be generated right now, given the image capability pref and whether
// a local diffusion backend is present? Surfaced at use-time so the Create-Image flow shows
// "Current API doesn't support image generation." instead of dispatching to a dead route.
//
//   online + a provider that supports image  → yes
//   online + a provider that does NOT         → no (the ask the plan calls out)
//   offline + local diffusion present         → yes
//   offline + no local diffusion              → no (offline image has no backend yet)
export function imageGenAvailable(args: {
  imagePref: CapabilityPref | undefined
  localImagePresent: boolean
  catalog: CapabilitySupportMeta[]
}): boolean {
  const { imagePref, localImagePresent, catalog } = args
  if (imagePref?.mode === "online" && imagePref.providerId) {
    return capabilitySupport("image", imagePref.providerId, catalog)
  }
  return localImagePresent
}
