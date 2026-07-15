import { describe, it, expect } from "vitest"
import {
  applyGlobalMode,
  capabilitySupport,
  deriveGlobalMode,
  imageGenAvailable,
  imageUnavailableReason,
  IMAGE_UNSUPPORTED_CLOUD,
  IMAGE_UNAVAILABLE_LOCAL,
  providerCapabilitySummary,
  type CapabilityPref,
  type CapabilitySupportMeta,
} from "./globalMode"

// Mirrors main's CAPABILITIES onlineProviders (the source of truth for what each cloud
// path can route to). If those diverge the real app breaks, so the test uses the real
// shape rather than a toy one.
const CATALOG: CapabilitySupportMeta[] = [
  { id: "chat", onlineProviders: [] },
  { id: "image", onlineProviders: ["openai", "openrouter"] },
  { id: "research", onlineProviders: ["openai", "openrouter", "groq", "deepseek", "mistral", "xai"] },
  { id: "vision", onlineProviders: ["openai", "openrouter"] },
  { id: "browser", onlineProviders: ["openrouter", "openai"] },
]

const PROVIDERS = [
  { id: "openai", defaultModel: "gpt-4o" },
  { id: "groq", defaultModel: "llama-3.3-70b-versatile" },
  { id: "anthropic", defaultModel: "claude-x" },
]
const LOCAL = "llamacpp/qwen3-4b-instruct-2507"

describe("capabilitySupport", () => {
  it("chat is universal — every provider can chat", () => {
    expect(capabilitySupport("chat", "anthropic", CATALOG)).toBe(true)
    expect(capabilitySupport("chat", "groq", CATALOG)).toBe(true)
  })
  it("openai supports image/vision/research/browser", () => {
    for (const c of ["image", "vision", "research", "browser"] as const) {
      expect(capabilitySupport(c, "openai", CATALOG)).toBe(true)
    }
  })
  it("groq does research but NOT image/vision/browser", () => {
    expect(capabilitySupport("research", "groq", CATALOG)).toBe(true)
    expect(capabilitySupport("image", "groq", CATALOG)).toBe(false)
    expect(capabilitySupport("vision", "groq", CATALOG)).toBe(false)
    expect(capabilitySupport("browser", "groq", CATALOG)).toBe(false)
  })
  it("anthropic is chat-only in this catalog", () => {
    expect(capabilitySupport("chat", "anthropic", CATALOG)).toBe(true)
    expect(capabilitySupport("research", "anthropic", CATALOG)).toBe(false)
    expect(capabilitySupport("image", "anthropic", CATALOG)).toBe(false)
  })
  it("websearch inherits research's support (no allowlist of its own)", () => {
    expect(capabilitySupport("websearch", "groq", CATALOG)).toBe(true) // groq does research
    expect(capabilitySupport("websearch", "anthropic", CATALOG)).toBe(false) // anthropic doesn't
  })
})

describe("providerCapabilitySummary", () => {
  it("openai: everything supported", () => {
    const s = providerCapabilitySummary("openai", CATALOG)
    expect(s.supported).toEqual(["chat", "image", "research", "vision", "browser"])
    expect(s.unsupported).toEqual([])
  })
  it("groq: chat+research supported, the rest not", () => {
    const s = providerCapabilitySummary("groq", CATALOG)
    expect(s.supported).toEqual(["chat", "research"])
    expect(s.unsupported).toEqual(["image", "vision", "browser"])
  })
  it("anthropic: chat only", () => {
    const s = providerCapabilitySummary("anthropic", CATALOG)
    expect(s.supported).toEqual(["chat"])
    expect(s.unsupported).toEqual(["image", "research", "vision", "browser"])
  })
})

describe("applyGlobalMode", () => {
  it("Local → every cap offline, chat = local model", () => {
    const r = applyGlobalMode({ target: { kind: "local" }, catalog: CATALOG, providers: PROVIDERS, localModelId: LOCAL })
    expect(r.chatModelId).toBe(LOCAL)
    expect(Object.values(r.prefs).every((p) => p.mode === "offline")).toBe(true)
    expect(r.unsupported).toEqual([])
  })
  it("Cloud+OpenAI → all caps online:openai, chat = openai default", () => {
    const r = applyGlobalMode({ target: { kind: "cloud", providerId: "openai" }, catalog: CATALOG, providers: PROVIDERS, localModelId: LOCAL })
    expect(r.chatModelId).toBe("openai/gpt-4o")
    for (const id of ["image", "research", "vision", "browser"] as const) {
      expect(r.prefs[id]).toEqual({ mode: "online", providerId: "openai" })
    }
    expect(r.unsupported).toEqual([])
  })
  it("Cloud+Groq → research online:groq; image/vision/browser stay OFFLINE (no fabricated route)", () => {
    const r = applyGlobalMode({ target: { kind: "cloud", providerId: "groq" }, catalog: CATALOG, providers: PROVIDERS, localModelId: LOCAL })
    expect(r.chatModelId).toBe("groq/llama-3.3-70b-versatile")
    expect(r.prefs.research).toEqual({ mode: "online", providerId: "groq" })
    expect(r.prefs.image).toEqual({ mode: "offline" })
    expect(r.prefs.vision).toEqual({ mode: "offline" })
    expect(r.prefs.browser).toEqual({ mode: "offline" })
    expect(r.unsupported).toEqual(["image", "vision", "browser"])
  })
  it("Cloud+Anthropic (chat-only) → all non-chat caps offline, chat = anthropic default", () => {
    const r = applyGlobalMode({ target: { kind: "cloud", providerId: "anthropic" }, catalog: CATALOG, providers: PROVIDERS, localModelId: LOCAL })
    expect(r.chatModelId).toBe("anthropic/claude-x")
    expect(Object.values(r.prefs).every((p) => p.mode === "offline")).toBe(true)
    expect(r.unsupported).toEqual(["image", "research", "vision", "browser"])
  })
  it("Cloud with an unknown provider (no defaultModel) falls chat back to local rather than emitting a bad id", () => {
    const r = applyGlobalMode({ target: { kind: "cloud", providerId: "mystery" }, catalog: CATALOG, providers: PROVIDERS, localModelId: LOCAL })
    expect(r.chatModelId).toBe(LOCAL)
  })
})

describe("deriveGlobalMode — round-trips applyGlobalMode", () => {
  const derive = (prefs: Record<string, CapabilityPref>, chatIsLocal: boolean, chatProviderId: string | null) =>
    deriveGlobalMode({ prefs, chatIsLocal, chatProviderId, catalog: CATALOG })

  it("all-offline + local chat → Local", () => {
    const { prefs } = applyGlobalMode({ target: { kind: "local" }, catalog: CATALOG, providers: PROVIDERS, localModelId: LOCAL })
    expect(derive(prefs, true, null)).toEqual({ kind: "local" })
  })
  it("applyGlobalMode(Cloud+OpenAI) derives back to Cloud+OpenAI", () => {
    const { prefs } = applyGlobalMode({ target: { kind: "cloud", providerId: "openai" }, catalog: CATALOG, providers: PROVIDERS, localModelId: LOCAL })
    expect(derive(prefs, false, "openai")).toEqual({ kind: "cloud", providerId: "openai" })
  })
  it("applyGlobalMode(Cloud+Groq) derives back to Cloud+Groq even though 3 caps stay offline", () => {
    const { prefs } = applyGlobalMode({ target: { kind: "cloud", providerId: "groq" }, catalog: CATALOG, providers: PROVIDERS, localModelId: LOCAL })
    // the honest partial-support state must still read as Cloud(groq), not Mixed
    expect(derive(prefs, false, "groq")).toEqual({ kind: "cloud", providerId: "groq" })
  })
  it("applyGlobalMode(Cloud+Anthropic) derives back to Cloud+Anthropic (chat-only)", () => {
    const { prefs } = applyGlobalMode({ target: { kind: "cloud", providerId: "anthropic" }, catalog: CATALOG, providers: PROVIDERS, localModelId: LOCAL })
    expect(derive(prefs, false, "anthropic")).toEqual({ kind: "cloud", providerId: "anthropic" })
  })

  it("two different providers across caps → Mixed", () => {
    const prefs = {
      image: { mode: "online", providerId: "openai" },
      research: { mode: "online", providerId: "groq" },
      vision: { mode: "offline" },
      browser: { mode: "offline" },
    } as Record<string, CapabilityPref>
    expect(derive(prefs, false, "openai")).toEqual({ kind: "mixed" })
  })
  it("caps online:openai but chat still LOCAL → Mixed (not a clean Cloud)", () => {
    const { prefs } = applyGlobalMode({ target: { kind: "cloud", providerId: "openai" }, catalog: CATALOG, providers: PROVIDERS, localModelId: LOCAL })
    expect(derive(prefs, true, null)).toEqual({ kind: "mixed" })
  })
  it("all offline but chat is CLOUD → Mixed (not Local)", () => {
    const { prefs } = applyGlobalMode({ target: { kind: "local" }, catalog: CATALOG, providers: PROVIDERS, localModelId: LOCAL })
    expect(derive(prefs, false, "openai")).toEqual({ kind: "mixed" })
  })
  it("a supported cap left offline under Cloud+OpenAI → Mixed (openai CAN do image, so image offline is not clean)", () => {
    const prefs = {
      image: { mode: "offline" }, // openai supports image, so this is a partial/mixed state
      research: { mode: "online", providerId: "openai" },
      vision: { mode: "online", providerId: "openai" },
      browser: { mode: "online", providerId: "openai" },
    } as Record<string, CapabilityPref>
    expect(derive(prefs, false, "openai")).toEqual({ kind: "mixed" })
  })
  it("online-without-provider is incoherent → Mixed", () => {
    const prefs = { image: { mode: "online" } } as Record<string, CapabilityPref>
    expect(derive(prefs, false, "openai")).toEqual({ kind: "mixed" })
  })
})

describe("imageGenAvailable", () => {
  it("online + image-capable provider → yes", () => {
    expect(imageGenAvailable({ imagePref: { mode: "online", providerId: "openai" }, localImagePresent: false, catalog: CATALOG })).toBe(true)
  })
  it("online + provider that can't do images (groq) → NO (the ask the plan calls out)", () => {
    expect(imageGenAvailable({ imagePref: { mode: "online", providerId: "groq" }, localImagePresent: false, catalog: CATALOG })).toBe(false)
  })
  it("offline + local diffusion present → yes", () => {
    expect(imageGenAvailable({ imagePref: { mode: "offline" }, localImagePresent: true, catalog: CATALOG })).toBe(true)
  })
  it("offline + no local diffusion → NO (offline image has no backend yet)", () => {
    expect(imageGenAvailable({ imagePref: { mode: "offline" }, localImagePresent: false, catalog: CATALOG })).toBe(false)
  })
  it("undefined pref behaves as offline", () => {
    expect(imageGenAvailable({ imagePref: undefined, localImagePresent: true, catalog: CATALOG })).toBe(true)
    expect(imageGenAvailable({ imagePref: undefined, localImagePresent: false, catalog: CATALOG })).toBe(false)
  })
})

describe("imageUnavailableReason", () => {
  it("returns null when image gen is available (supported cloud provider)", () => {
    expect(imageUnavailableReason({ imagePref: { mode: "online", providerId: "openai" }, localImagePresent: false, catalog: CATALOG })).toBeNull()
  })
  it("returns null when image gen is available (local backend present)", () => {
    expect(imageUnavailableReason({ imagePref: { mode: "offline" }, localImagePresent: true, catalog: CATALOG })).toBeNull()
  })
  it("online + unsupported provider → the plan's exact 'Current API…' copy", () => {
    expect(imageUnavailableReason({ imagePref: { mode: "online", providerId: "groq" }, localImagePresent: false, catalog: CATALOG })).toBe(IMAGE_UNSUPPORTED_CLOUD)
  })
  it("offline + no local backend → points at a cloud provider", () => {
    expect(imageUnavailableReason({ imagePref: { mode: "offline" }, localImagePresent: false, catalog: CATALOG })).toBe(IMAGE_UNAVAILABLE_LOCAL)
  })
})
