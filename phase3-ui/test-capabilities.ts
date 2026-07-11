// Headless verification for the per-capability prefs store (PR1).
// Mocks `electron` so app.getPath("userData") points at a temp dir, then proves the
// store round-trips, defaults every capability to OFFLINE, sanitizes a half-formed
// "online" choice down to offline (never a silent cloud route), rejects unknown
// capabilities, and survives a simulated restart (the store reads disk every call).
// Also checks the chat model <-> pref mapping used to persist the switcher choice.
//   Run: bun test-capabilities.ts
import { mock } from "bun:test"
import { mkdtempSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const USERDATA = mkdtempSync(join(tmpdir(), "capability-prefs-test-"))
mock.module("electron", () => ({ app: { getPath: () => USERDATA } }))

const caps = await import("./src/main/capabilities")
const { chatModelToPref, prefToChatModel, resolveActiveModel, availableOnlineProviders, nextOnlineProvider } =
  await import("./src/renderer/src/lib/capabilities")
const { resolveImageBackend } = await import("./src/main/image-endpoint")
const { isLocalModel, LOCAL_MODEL, OPENROUTER_FREE_CHOICE } = await import("./src/renderer/src/lib/byok")

let failures = 0
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.error(`  FAIL ${name}`, detail ?? "")
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// 1) Empty store → every capability present and OFFLINE by default.
const initial = caps.listPrefs()
check("5 capabilities enumerated", eq(Object.keys(initial).sort(), ["browser", "chat", "image", "research", "vision"]), Object.keys(initial))
check("all default to offline", Object.values(initial).every((p) => p.mode === "offline"), initial)
check("no store file until first write", !existsSync(join(USERDATA, "capability-prefs.json")))

// 2) Explicit online choice round-trips and persists to disk.
const saved = caps.setPref("image", { mode: "online", providerId: "openai", modelId: "dall-e-3" })
check("setPref returns the clean online pref", eq(saved, { mode: "online", providerId: "openai", modelId: "dall-e-3" }), saved)
check("getPref reflects it", eq(caps.getPref("image"), { mode: "online", providerId: "openai", modelId: "dall-e-3" }))
const onDisk = JSON.parse(readFileSync(join(USERDATA, "capability-prefs.json"), "utf8"))
check("persisted to disk", eq(onDisk.image, { mode: "online", providerId: "openai", modelId: "dall-e-3" }), onDisk)

// 3) Simulated restart: a fresh listPrefs (reads disk) still has the choice.
check("survives restart (fresh read)", eq(caps.listPrefs().image, { mode: "online", providerId: "openai", modelId: "dall-e-3" }))

// 4) Sanitize: online with NO provider is meaningless → coerced to offline (safety).
check("online w/o provider → offline", eq(caps.setPref("browser", { mode: "online" } as any), { mode: "offline" }))
check("blank provider → offline", eq(caps.setPref("browser", { mode: "online", providerId: "   " }), { mode: "offline" }))
check("provider trimmed, modelId optional", eq(caps.setPref("browser", { mode: "online", providerId: " openrouter " }), { mode: "online", providerId: "openrouter" }))

// 5) Unknown capability id is rejected (can't persist junk).
let threw = false
try { caps.setPref("bogus", { mode: "offline" }) } catch { threw = true }
check("unknown capability throws", threw)

// 6) Switching back to offline clears the provider.
check("offline clears provider", eq(caps.setPref("image", { mode: "offline" }), { mode: "offline" }))

// 7) Chat model <-> pref mapping (drives switcher persistence).
check("local model → offline pref", eq(chatModelToPref(LOCAL_MODEL.id, isLocalModel(LOCAL_MODEL.id)), { mode: "offline" }))
check(
  "cloud model → online pref (first-slash split)",
  eq(chatModelToPref("openai/gpt-4o", isLocalModel("openai/gpt-4o")), { mode: "online", providerId: "openai", modelId: "gpt-4o" }),
)
check(
  "OpenRouter free model keeps inner slashes",
  eq(chatModelToPref(OPENROUTER_FREE_CHOICE.id, isLocalModel(OPENROUTER_FREE_CHOICE.id)), {
    mode: "online",
    providerId: "openrouter",
    modelId: "meta-llama/llama-3.3-70b-instruct:free",
  }),
)
check("prefToChatModel round-trips the OpenRouter free id", prefToChatModel(chatModelToPref(OPENROUTER_FREE_CHOICE.id, false)) === OPENROUTER_FREE_CHOICE.id)
check("prefToChatModel(offline) → null", prefToChatModel({ mode: "offline" }) === null)
check("prefToChatModel(online w/o model) → null", prefToChatModel({ mode: "online", providerId: "openai" }) === null)

// 8) resolveActiveModel — the model-load decision (Bugbot #1 race + #2 stale heal).
const LOCAL = "llamacpp/qwen3-4b-instruct-2507"
const avail = [LOCAL, "openai/gpt-4o", "openrouter/x"]
// First load, no user pick yet → restore a persisted, still-available cloud choice.
check(
  "restore applies when user hasn't picked",
  eq(resolveActiveModel({ availableIds: avail, current: LOCAL, localId: LOCAL, restore: "openai/gpt-4o", userSelected: false }), {
    resolved: "openai/gpt-4o",
    healToOffline: false,
  }),
)
// Bugbot #1: the user changed the switcher while the load was in flight → their pick
// (reflected in `current`) must win; the persisted `restore` must NOT clobber it.
check(
  "user pick during load beats restore",
  eq(resolveActiveModel({ availableIds: avail, current: "openrouter/x", localId: LOCAL, restore: "openai/gpt-4o", userSelected: true }), {
    resolved: "openrouter/x",
    healToOffline: false,
  }),
)
// Bugbot #2: the chosen cloud model's key was removed (no longer available) → heal to
// local AND flag healToOffline so the caller persists offline (no silent cloud later).
check(
  "unavailable cloud choice heals to local + flags persist",
  eq(resolveActiveModel({ availableIds: [LOCAL], current: "openai/gpt-4o", localId: LOCAL, restore: null, userSelected: true }), {
    resolved: LOCAL,
    healToOffline: true,
  }),
)
// First-load restore that points at a now-keyless provider → same heal+persist.
check(
  "restore to unavailable provider heals + flags persist",
  eq(resolveActiveModel({ availableIds: [LOCAL], current: LOCAL, localId: LOCAL, restore: "openai/gpt-4o", userSelected: false }), {
    resolved: LOCAL,
    healToOffline: true,
  }),
)
// Staying on local (already local) is not a heal — must NOT spuriously persist.
check(
  "local→local is not a heal",
  eq(resolveActiveModel({ availableIds: avail, current: LOCAL, localId: LOCAL, restore: null, userSelected: true }), {
    resolved: LOCAL,
    healToOffline: false,
  }),
)

// 9) Capabilities UI provider-selection helpers (PR2).
// Intersection preserves the capability's allowlist ORDER, not the configured order.
check(
  "availableOnlineProviders intersects + keeps allowlist order",
  eq(availableOnlineProviders(["openai", "openrouter", "groq"], ["groq", "openai"]), ["openai", "groq"]),
)
check("availableOnlineProviders → [] when no key matches", eq(availableOnlineProviders(["openai", "openrouter"], ["anthropic"]), []))
check("nextOnlineProvider keeps a still-available current", nextOnlineProvider("openrouter", ["openai", "openrouter"]) === "openrouter")
check("nextOnlineProvider falls back to first available", nextOnlineProvider("openai", ["openrouter", "groq"]) === "openrouter")
check("nextOnlineProvider(undefined) → first available", nextOnlineProvider(undefined, ["openai"]) === "openai")
check("nextOnlineProvider(none available) → undefined", nextOnlineProvider("openai", []) === undefined)

// The UI catalog the store exposes must match the UI-row list (chat excluded).
check("UI_CAPABILITIES excludes chat", eq(caps.UI_CAPABILITIES, ["image", "research", "vision", "browser"]))
check(
  "every UI capability has ≥1 online provider in its allowlist",
  caps.UI_CAPABILITIES.every((id: string) => (caps.CAPABILITIES.find((c: any) => c.id === id)?.onlineProviders.length ?? 0) > 0),
)

// 10) resolveImageBackend — PROVES the OpenAI>OpenRouter precedence is gone (PR3).
const off = { mode: "offline" as const }
const onOA = { mode: "online" as const, providerId: "openai" }
const onOR = { mode: "online" as const, providerId: "openrouter" }
// Offline uses local only, and NEVER cloud even when both keys exist.
check("offline + local ready → local", resolveImageBackend(off, true, true, true) === "local")
check("offline + local down → none (no silent cloud)", resolveImageBackend(off, false, true, true) === "none")
// Online honors EXACTLY the chosen provider.
check("online openai + key → openai", resolveImageBackend(onOA, false, true, false) === "openai")
check("online openrouter + key → openrouter", resolveImageBackend(onOR, false, false, true) === "openrouter")
// THE precedence-removal cases:
check(
  "online openrouter wins even when an OpenAI key is present (old precedence gone)",
  resolveImageBackend(onOR, false, true, true) === "openrouter",
)
check(
  "online openai selected but only OpenRouter key present → none (NO silent fallback)",
  resolveImageBackend(onOA, false, false, true) === "none",
)
check("online openrouter selected but only OpenAI key present → none", resolveImageBackend(onOR, false, true, false) === "none")
check("online unsupported provider → none", resolveImageBackend({ mode: "online", providerId: "anthropic" }, false, true, true) === "none")

// 11) capabilities.envForOpencode() — the browser silent-cloud fix (PR4). Default
// must be local; only an explicit Online choice names a provider.
caps.setPref("browser", { mode: "offline" })
check("browser offline → PROVIDER=local", caps.envForOpencode().NIGHTJAR_BROWSERUSE_PROVIDER === "local")
caps.setPref("browser", { mode: "online", providerId: "openrouter" })
check("browser online/openrouter → PROVIDER=openrouter", caps.envForOpencode().NIGHTJAR_BROWSERUSE_PROVIDER === "openrouter")
caps.setPref("browser", { mode: "online", providerId: "openai" })
check("browser online/openai → PROVIDER=openai", caps.envForOpencode().NIGHTJAR_BROWSERUSE_PROVIDER === "openai")
// online-without-provider is sanitized to offline by the store → PROVIDER=local (no leak)
caps.setPref("browser", { mode: "online" } as any)
check("browser online w/o provider → PROVIDER=local", caps.envForOpencode().NIGHTJAR_BROWSERUSE_PROVIDER === "local")
caps.setPref("browser", { mode: "offline" }) // restore

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
