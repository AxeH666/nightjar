import { describe, test, expect, beforeEach, vi } from "vitest"

// NJ-68: `voice:set` used to take a boolean and enable the microphone, trusting that the
// RENDERER had shown its consent modal. Nothing in main enforced that, so anything holding
// the preload bridge could open the mic silently — while KNOWN_ISSUES.md stated as shipped
// fact that "enabling always passes through a consent modal".
//
// Reading the diff proves nothing here: the PRE-fix code already read as though it had a
// consent flow. These drive the real consent module and the real pref store.
//
// LIMIT (rules 6/8): this is the headless layer. It does NOT exercise the Electron IPC
// round-trip, the native dialog, or any microphone. The dialog appearing in front of the
// window, and Esc mapping to DENY, can only be confirmed on a real Windows desktop session —
// that check is listed in the PR body, not claimed here.

vi.mock("electron", () => ({
  dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
  app: { getPath: () => process.env.NJ_TEST_USERDATA! },
}))

import { mkdtempSync, existsSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

process.env.NJ_TEST_USERDATA = mkdtempSync(join(tmpdir(), "njvoice-"))

const { askForMicConsent, __resetConsentForTests, nativeConsentAsker, invalidatePendingConsent } =
  await import("./voiceConsent")
const voice = await import("./voice")

const prefPath = () => join(process.env.NJ_TEST_USERDATA!, "voice-pref.json")
const readPref = () => (existsSync(prefPath()) ? JSON.parse(readFileSync(prefPath(), "utf8")) : null)

const grant = async () => vi.fn(async () => true)
const deny = async () => vi.fn(async () => false)

beforeEach(() => {
  __resetConsentForTests()
})

describe("mic consent gate (NJ-68)", () => {
  test("a granted consent produces a token that enables voice", async () => {
    const consent = await askForMicConsent(null, await grant())
    expect(consent).not.toBeNull()
    const pref = voice.enableVoice(consent!)
    expect(pref.enabled).toBe(true)
    expect(pref.consentedAt).toBeTruthy()
    expect(readPref().enabled).toBe(true)
  })

  test("a denied consent returns null — and NOTHING is written", async () => {
    voice.disableVoice()
    const before = statSync(prefPath()).mtimeMs
    const consent = await askForMicConsent(null, await deny())
    expect(consent).toBeNull()
    // Assert no write occurred at all, not merely that the final state is false: a
    // write-then-rollback implementation passes a final-state check while still leaving a
    // crash window that persists {enabled:true} into a hot mic at the next launch.
    expect(statSync(prefPath()).mtimeMs).toBe(before)
    expect(readPref().enabled).toBe(false)
  })

  test("an asker that THROWS is a denial, never a fail-open", async () => {
    const consent = await askForMicConsent(
      null,
      vi.fn(async () => {
        throw new Error("no window")
      }),
    )
    expect(consent).toBeNull()
  })

  test("the native asker denies with no window rather than prompting unattended", async () => {
    expect(await nativeConsentAsker(null)).toBe(false)
    expect(await nativeConsentAsker({ isDestroyed: () => true } as never)).toBe(false)
  })

  test("concurrent asks are single-flighted — one prompt, not N", async () => {
    let resolveAsk: (v: boolean) => void = () => {}
    const asker = vi.fn(() => new Promise<boolean>((r) => (resolveAsk = r)))
    const all = Promise.all([
      askForMicConsent(null, asker),
      askForMicConsent(null, asker),
      askForMicConsent(null, asker),
    ])
    resolveAsk(true)
    const results = await all
    expect(asker).toHaveBeenCalledTimes(1)
    // All three callers observe the same single decision.
    expect(results.every((r) => r !== null)).toBe(true)
  })

  test("consentedAt refreshes on each consented enable (it used to stamp only the first)", async () => {
    const c1 = await askForMicConsent(null, await grant())
    const first = voice.enableVoice(c1!).consentedAt
    voice.disableVoice()
    await new Promise((r) => setTimeout(r, 5))
    __resetConsentForTests()
    const c2 = await askForMicConsent(null, await grant())
    const second = voice.enableVoice(c2!).consentedAt
    expect(second).not.toBe(first)
  })

  test("disable keeps the prior consentedAt and needs no consent (kill-switch invariant)", async () => {
    const c = await askForMicConsent(null, await grant())
    const stamped = voice.enableVoice(c!).consentedAt
    const off = voice.disableVoice() // zero arguments — must always typecheck and always work
    expect(off.enabled).toBe(false)
    expect(off.consentedAt).toBe(stamped)
    expect(voice.getVoiceEnabled()).toBe(false)
  })

  // Bugbot PR #156 (High): the consent ask is async, so a disable can land while the dialog
  // is still up — from the orb kill switch, DevTools, or any bridge caller. Before this, the
  // enable resumed after consent and wrote {enabled:true} OVER a disable the user asked for
  // afterwards, silently re-opening the microphone.
  describe("a disable during a pending ask supersedes it (Bugbot #156)", () => {
    test("consent granted after a disable does NOT produce a token", async () => {
      let resolveAsk: (v: boolean) => void = () => {}
      const asker = vi.fn(() => new Promise<boolean>((r) => (resolveAsk = r)))
      const inFlight = askForMicConsent(null, asker)

      // The user hits the kill switch while the dialog is open.
      invalidatePendingConsent()
      // ...and only then does the dialog come back affirmative.
      resolveAsk(true)

      expect(await inFlight).toBeNull()
    })

    test("the full sequence leaves voice OFF, not resurrected", async () => {
      // Start from ON so the disable is a real state change.
      const c0 = await askForMicConsent(null, await grant())
      voice.enableVoice(c0!)
      expect(voice.getVoiceEnabled()).toBe(true)
      __resetConsentForTests()

      let resolveAsk: (v: boolean) => void = () => {}
      const enable = (async () => {
        const c = await askForMicConsent(null, () => new Promise<boolean>((r) => (resolveAsk = r)))
        if (!c) return "abandoned"
        voice.enableVoice(c)
        return "enabled"
      })()

      // Disable lands mid-ask: this is what the handler does.
      invalidatePendingConsent()
      voice.disableVoice()

      resolveAsk(true)
      expect(await enable).toBe("abandoned")
      expect(voice.getVoiceEnabled()).toBe(false)
      expect(readPref().enabled).toBe(false)
    })

    test("a disable does not poison the NEXT, legitimate ask", async () => {
      invalidatePendingConsent()
      __resetConsentForTests()
      const c = await askForMicConsent(null, await grant())
      expect(c).not.toBeNull() // the counter gates in-flight asks only, not future ones
    })
  })

  test("the store fails closed on a corrupt file", async () => {
    const c = await askForMicConsent(null, await grant())
    voice.enableVoice(c!)
    expect(voice.getVoiceEnabled()).toBe(true)
    const { writeFileSync } = await import("node:fs")
    writeFileSync(prefPath(), "{ not json")
    expect(voice.getVoiceEnabled()).toBe(false)
  })
})
