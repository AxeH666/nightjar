// Headless re-trigger of the NIGHTJAR_BYOK_ALLOW_INSECURE regression (rule 6).
// Mocks `electron` so we control safeStorage: with NO OS keychain,
// isEncryptionAvailable() is false and encryptString() THROWS exactly as Electron does
// on a keyring-less box — the failure the user hit. Then proves the fix: setKey no
// longer throws, the key round-trips, and it reaches the engine env. Also checks the
// real-keychain path + legacy un-prefixed back-compat did not regress.
//   Run: bun test-byok-insecure.ts
import { mock } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const USERDATA = mkdtempSync(join(tmpdir(), "byok-insecure-test-"))
process.env.NIGHTJAR_BYOK_ALLOW_INSECURE = "1" // arm the test hatch

// Mutable backend state so one imported byok module can be driven through both the
// no-keychain and the keychain-present scenarios (byok calls these fresh each time).
const backend = { available: false }
// Reversible stand-in for the OS cipher (only used when available === true).
const seal = (s: string) => Buffer.from("CIPHER(" + Buffer.from(s, "utf8").toString("base64") + ")", "utf8")
const open = (buf: Buffer) => {
  const m = /^CIPHER\((.*)\)$/.exec(buf.toString("utf8"))
  if (!m) throw new Error("bad cipher")
  return Buffer.from(m[1], "base64").toString("utf8")
}

mock.module("electron", () => ({
  app: { getPath: () => USERDATA },
  safeStorage: {
    isEncryptionAvailable: () => backend.available,
    encryptString: (s: string) => {
      if (!backend.available)
        throw new Error("Error while encrypting the text provided to safeStorage.encryptString. Encryption is not available.")
      return seal(s)
    },
    decryptString: (buf: Buffer) => {
      if (!backend.available) throw new Error("Decryption is not available")
      return open(buf)
    },
  },
}))

const byok = await import("./src/main/byok")
const storeFile = join(USERDATA, "byok-keys.json")
const rawStore = (): Record<string, string> => JSON.parse(require("node:fs").readFileSync(storeFile, "utf8"))

let pass = 0,
  fail = 0
const check = (n: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${n}${extra ? " — " + extra : ""}`)
  ok ? pass++ : fail++
}

// ── Scenario A: NO keychain + ALLOW_INSECURE (the regression case) ──────────────
backend.available = false
check("A1 keyStorageMode() === 'insecure'", byok.keyStorageMode() === "insecure", byok.keyStorageMode())

let threw = false
try {
  byok.setKey("openrouter", "  sk-or-testkey-123  ") // whitespace to also verify trim
} catch (e) {
  threw = true
  console.log("   setKey threw:", (e as Error).message)
}
check("A2 setKey does NOT throw with no keychain (was the bug)", !threw)
check("A3 stored value uses the insec: tag (safeStorage bypassed)", (rawStore().openrouter ?? "").startsWith("insec:"), rawStore().openrouter)
check("A4 getKey round-trips (trimmed)", byok.getKey("openrouter") === "sk-or-testkey-123", String(byok.getKey("openrouter")))
check(
  "A5 listStatus shows openrouter hasKey === true",
  byok.listStatus().find((p) => p.id === "openrouter")?.hasKey === true,
)
check(
  "A6 envForOpencode injects NIGHTJAR_BYOK_OPENROUTER for the engine",
  byok.envForOpencode()["NIGHTJAR_BYOK_OPENROUTER"] === "sk-or-testkey-123",
)

// ── Scenario B: keychain PRESENT → real-cipher path must still work ─────────────
backend.available = true
check("B1 keyStorageMode() === 'encrypted'", byok.keyStorageMode() === "encrypted")
byok.setKey("openai", "sk-openai-xyz")
check("B2 stored value uses the enc: tag", (rawStore().openai ?? "").startsWith("enc:"), rawStore().openai)
check("B3 getKey round-trips through safeStorage", byok.getKey("openai") === "sk-openai-xyz")
check("B4 envForOpencode injects NIGHTJAR_BYOK_OPENAI", byok.envForOpencode()["NIGHTJAR_BYOK_OPENAI"] === "sk-openai-xyz")

// ── Scenario C: legacy un-prefixed ciphertext (written before the scheme tag) ───
const legacy = { ...rawStore(), anthropic: seal("legacy-anthropic-key").toString("base64") } // NO prefix
writeFileSync(storeFile, JSON.stringify(legacy))
check("C1 legacy un-prefixed entry still decrypts (back-compat)", byok.getKey("anthropic") === "legacy-anthropic-key", String(byok.getKey("anthropic")))

// ── Scenario D: ciphertext present but un-decryptable → reported as absent ──────
backend.available = false // keychain vanished; the enc/legacy entries can no longer open
check("D1 undecryptable openai reported hasKey === false", byok.listStatus().find((p) => p.id === "openai")?.hasKey === false)
check("D2 the insec openrouter key STILL usable with no keychain", byok.listStatus().find((p) => p.id === "openrouter")?.hasKey === true)

console.log(`\n==== byok insecure hatch: ${pass} passed, ${fail} failed ====`)
process.exit(fail > 0 ? 1 : 0)
