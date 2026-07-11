// Nightjar per-capability provider preferences — main process only.
//
// Replaces the implicit local-vs-cloud / provider-precedence that used to be decided
// automatically (image-gen preferred OpenAI>OpenRouter; browser-use preferred
// OpenRouter>OpenAI and went cloud whenever any key existed) with an EXPLICIT,
// persisted, per-capability choice. Offline/local is ALWAYS the default; going Online
// and picking a provider is always a deliberate user action. This module is the single
// source of truth for those choices; the per-capability WIRING (image reconcile,
// browser/research/vision env, engine restart) is added in later PRs that read here.
//
// Persisted like byok-keys.json (userData/capability-prefs.json), but — unlike keys —
// this holds NO secrets, only {mode, providerId, modelId}, so it is plain JSON at 0600.
import { app } from "electron"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"

export type CapabilityId = "chat" | "image" | "research" | "vision" | "browser"
export type CapabilityMode = "offline" | "online"

export interface CapabilityPref {
  mode: CapabilityMode
  providerId?: string // BYOK provider id when mode === "online"
  modelId?: string // model id within that provider (may itself contain "/")
}

export interface CapabilityMeta {
  id: CapabilityId
  name: string
  // BYOK provider ids that make sense for this capability's ONLINE mode. An empty
  // list means "any configured chat-capable provider" (validated in the PRs that
  // build each cloud path); it is advisory metadata for the UI, not enforced here.
  onlineProviders: string[]
  offlineLabel: string // human label for the local/offline backend
}

// The capability catalog the UI renders one row per. Order = display order.
export const CAPABILITIES: CapabilityMeta[] = [
  { id: "chat", name: "Chat & coding", onlineProviders: [], offlineLabel: "Local · Qwen3-4B" },
  { id: "image", name: "Image generation", onlineProviders: ["openai", "openrouter"], offlineLabel: "Local diffusion (Z-Image)" },
  { id: "research", name: "Deep research", onlineProviders: [], offlineLabel: "Local · Qwen3-4B" },
  { id: "vision", name: "Vision (image analysis)", onlineProviders: [], offlineLabel: "Local · gemma3:4b" },
  { id: "browser", name: "Browser agent", onlineProviders: ["openrouter", "openai"], offlineLabel: "Local · Qwen3-4B" },
]

const DEFAULT_PREF: CapabilityPref = { mode: "offline" }

export function isCapabilityId(id: string): id is CapabilityId {
  return CAPABILITIES.some((c) => c.id === id)
}

function storePath(): string {
  return join(app.getPath("userData"), "capability-prefs.json")
}
function readStore(): Record<string, CapabilityPref> {
  try {
    const raw = JSON.parse(readFileSync(storePath(), "utf8"))
    return raw && typeof raw === "object" ? raw : {}
  } catch {
    return {}
  }
}
function writeStore(s: Record<string, CapabilityPref>): void {
  const p = storePath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(s, null, 2), { mode: 0o600 })
}

// Normalize/validate an incoming pref so a malformed renderer payload (or a legacy
// on-disk entry) can never persist junk or a half-formed "online" choice. An online
// pref with no provider is meaningless → coerced to offline (never a silent cloud
// route). This is the safety spine: every value that leaves this module is clean.
export function sanitize(pref: CapabilityPref | null | undefined): CapabilityPref {
  if (pref && pref.mode === "online") {
    const providerId = typeof pref.providerId === "string" ? pref.providerId.trim() : ""
    if (!providerId) return { mode: "offline" }
    const modelId = typeof pref.modelId === "string" && pref.modelId.trim() ? pref.modelId.trim() : undefined
    return modelId ? { mode: "online", providerId, modelId } : { mode: "online", providerId }
  }
  return { mode: "offline" }
}

export function getPref(id: CapabilityId): CapabilityPref {
  return sanitize(readStore()[id])
}

// The complete prefs map — every capability present, unset ones defaulted to offline,
// all sanitized — so the renderer can render every row without a load race.
export function listPrefs(): Record<CapabilityId, CapabilityPref> {
  const s = readStore()
  const out = {} as Record<CapabilityId, CapabilityPref>
  for (const c of CAPABILITIES) out[c.id] = sanitize(s[c.id]) ?? { ...DEFAULT_PREF }
  return out
}

// Persist a capability's pref (sanitized). Returns the stored value so the renderer
// stays in sync with any coercion (e.g. online-without-provider → offline).
export function setPref(id: string, pref: CapabilityPref): CapabilityPref {
  if (!isCapabilityId(id)) throw new Error(`unknown capability: ${id}`)
  const clean = sanitize(pref)
  const s = readStore()
  s[id] = clean
  writeStore(s)
  return clean
}
