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
const { chatModelToPref, prefToChatModel } = await import("./src/renderer/src/lib/capabilities")
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

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`)
process.exit(failures === 0 ? 0 : 1)
