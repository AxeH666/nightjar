// Nightjar BYOK (bring-your-own-key) — secure key store, main process only.
//
// SECURITY MODEL:
//  - Keys are encrypted at rest with Electron `safeStorage` (OS keychain:
//    macOS Keychain / Windows DPAPI / Linux libsecret-or-kwallet). We store the
//    encrypted bytes (base64) in userData/byok-keys.json — NEVER the plaintext.
//  - If the OS keychain is unavailable (e.g. a headless box with no keyring),
//    `safeStorage` falls back to a `basic_text` backend that is NOT real
//    encryption. In that case we REFUSE to persist a key rather than write
//    anything less than encrypted-at-rest. (A test-only override exists — see
//    ALLOW_INSECURE — never enabled in production.)
//  - The renderer NEVER receives raw keys: it gets a masked/status list only.
//    Decryption + injection into the engine happen here in the main process.
//
// KEY DELIVERY (scoping-by-construction): we inject each key under a
// NON-STANDARD env var (`NIGHTJAR_BYOK_<PROVIDER>`), NOT the provider's standard
// name (OPENAI_API_KEY, …). opencode.json references it via
// `options.apiKey = "{env:NIGHTJAR_BYOK_<PROVIDER>}"`. Because the *standard*
// vars are never set, no MCP capability (Row-Bot vision/embeddings, Odysseus)
// can silently route to a cloud API just because a key exists — they only ever
// see local endpoints.
import { safeStorage, app } from "electron"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"

export interface ByokProvider {
  id: string // opencode provider id (must match its models.dev registry id)
  name: string // display name
  envVar: string // non-standard var we inject; referenced by opencode.json {env:...}
  defaultModel: string // sensible default model id for the switcher
  keyHint: string // placeholder shown in the input
}

// Curated set of the common cloud providers OpenCode already supports. (OpenCode
// knows ~20 via the models.dev registry; these are the ones we surface in the UI.)
export const BYOK_PROVIDERS: ByokProvider[] = [
  { id: "openai", name: "OpenAI", envVar: "NIGHTJAR_BYOK_OPENAI", defaultModel: "gpt-4o", keyHint: "sk-…" },
  { id: "anthropic", name: "Anthropic", envVar: "NIGHTJAR_BYOK_ANTHROPIC", defaultModel: "claude-sonnet-4-20250514", keyHint: "sk-ant-…" },
  { id: "google", name: "Google Gemini", envVar: "NIGHTJAR_BYOK_GOOGLE", defaultModel: "gemini-2.0-flash", keyHint: "AIza…" },
  { id: "groq", name: "Groq", envVar: "NIGHTJAR_BYOK_GROQ", defaultModel: "llama-3.3-70b-versatile", keyHint: "gsk_…" },
  { id: "openrouter", name: "OpenRouter", envVar: "NIGHTJAR_BYOK_OPENROUTER", defaultModel: "openai/gpt-4o", keyHint: "sk-or-…" },
  { id: "mistral", name: "Mistral", envVar: "NIGHTJAR_BYOK_MISTRAL", defaultModel: "mistral-large-latest", keyHint: "…" },
  { id: "deepseek", name: "DeepSeek", envVar: "NIGHTJAR_BYOK_DEEPSEEK", defaultModel: "deepseek-chat", keyHint: "sk-…" },
  { id: "xai", name: "xAI Grok", envVar: "NIGHTJAR_BYOK_XAI", defaultModel: "grok-3", keyHint: "xai-…" },
]

// Optional mock provider for end-to-end testing without burning a real cloud key
// (a local OpenAI-compatible server that validates the injected Bearer token).
// Only surfaced when NIGHTJAR_BYOK_TEST_PROVIDER=1.
export const TEST_PROVIDER: ByokProvider = {
  id: "byoktest",
  name: "BYOK Test (mock)",
  envVar: "NIGHTJAR_BYOK_BYOKTEST",
  defaultModel: "mock-model",
  keyHint: "any-test-key",
}

export function providerCatalog(): ByokProvider[] {
  return process.env.NIGHTJAR_BYOK_TEST_PROVIDER === "1" ? [...BYOK_PROVIDERS, TEST_PROVIDER] : BYOK_PROVIDERS
}

function providerById(id: string): ByokProvider | undefined {
  return providerCatalog().find((p) => p.id === id)
}

// test-only escape hatch: exercise the flow on machines without an OS keychain.
// NEVER set in production — logged loudly when used.
const ALLOW_INSECURE = process.env.NIGHTJAR_BYOK_ALLOW_INSECURE === "1"

function storePath(): string {
  return join(app.getPath("userData"), "byok-keys.json")
}
function readStore(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(storePath(), "utf8"))
  } catch {
    return {}
  }
}
function writeStore(s: Record<string, string>): void {
  const p = storePath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(s, null, 2), { mode: 0o600 })
}

// How keys can be stored on THIS machine — drives the settings UI (enable/disable
// + honest messaging), so it must not overstate safety:
//  • "encrypted"   — real OS-keychain encryption is available.
//  • "insecure"    — no keychain, but the NIGHTJAR_BYOK_ALLOW_INSECURE test hatch
//                    is on, so setKey() will store via safeStorage's basic_text
//                    obfuscation. NOT real encryption — test only.
//  • "unavailable" — no keychain and no hatch → saving is refused (never plaintext).
export type KeyStorageMode = "encrypted" | "insecure" | "unavailable"

export function keyStorageMode(): KeyStorageMode {
  if (safeStorage.isEncryptionAvailable()) return "encrypted"
  return ALLOW_INSECURE ? "insecure" : "unavailable"
}

export function setKey(providerId: string, key: string): void {
  if (!providerById(providerId)) throw new Error(`unknown provider: ${providerId}`)
  const trimmed = key.trim()
  if (!trimmed) throw new Error("empty API key")
  if (!safeStorage.isEncryptionAvailable() && !ALLOW_INSECURE) {
    throw new Error(
      "OS secure storage (Keychain / DPAPI / libsecret) is unavailable on this machine — " +
        "refusing to store the API key as anything less than encrypted-at-rest. " +
        "Enable a system keyring (gnome-keyring / KWallet) or run on macOS/Windows.",
    )
  }
  if (!safeStorage.isEncryptionAvailable() && ALLOW_INSECURE) {
    console.warn(
      "[byok] ⚠️  NIGHTJAR_BYOK_ALLOW_INSECURE=1 and no OS keychain — storing via the " +
        "safeStorage basic_text fallback, which is NOT real encryption. TEST ONLY.",
    )
  }
  const encrypted = safeStorage.encryptString(trimmed) // real cipher on keychain OSes
  const s = readStore()
  s[providerId] = encrypted.toString("base64")
  writeStore(s)
}

export function removeKey(providerId: string): void {
  const s = readStore()
  if (providerId in s) {
    delete s[providerId]
    writeStore(s)
  }
}

function decrypt(b64: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(b64, "base64"))
  } catch {
    return null
  }
}

// MAIN-PROCESS ONLY — decrypt a single provider's key. Never exposed to renderer.
export function getKey(providerId: string): string | null {
  const b64 = readStore()[providerId]
  return b64 ? decrypt(b64) : null
}

// Status for the renderer — masked, never the raw key. `hasKey` must mean "a
// USABLE key is present", i.e. the ciphertext both exists AND decrypts — not just
// "ciphertext on disk". Otherwise a key that can no longer be decrypted (keychain
// reset, moved machine, safeStorage backend flip) would show as configured in the
// UI and be offered in the model switcher while envForOpencode() silently skips
// it, so the engine never gets it — a confusing "key set but cloud calls fail".
export function listStatus(): Array<ByokProvider & { hasKey: boolean }> {
  const s = readStore()
  return providerCatalog().map((p) => ({ ...p, hasKey: Boolean(s[p.id]) && decrypt(s[p.id]) !== null }))
}

// MAIN-PROCESS ONLY: decrypt everything into the non-standard env vars that
// opencode.json references. This is what gets injected into opencode-serve.
export function envForOpencode(): Record<string, string> {
  const s = readStore()
  const out: Record<string, string> = {}
  for (const p of providerCatalog()) {
    const b64 = s[p.id]
    if (!b64) continue
    const k = decrypt(b64)
    if (k) out[p.envVar] = k
    else
      console.warn(
        `[byok] stored key for "${p.id}" is present but could not be decrypted ` +
          "(OS keychain changed?) — skipping injection; re-enter the key to restore it. " +
          "listStatus() reports it as absent so it stays consistent with this.",
      )
  }
  return out
}
