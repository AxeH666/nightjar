// Mic consent — main process only (NJ-68).
//
// NJ-57 made voice OFF by default and routed enabling through a consent modal in the
// renderer (VoiceSettings.tsx). But the modal was the ONLY thing enforcing it: the
// `voice:set` IPC handler took a boolean and enabled the microphone, so anything holding
// the preload bridge — DevTools, a compromised renderer dependency, future in-tree code —
// could open the mic with no prompt. KNOWN_ISSUES.md stated as shipped fact that "enabling
// always passes through a consent modal"; nothing in main enforced that.
//
// Two layers, deliberately:
//   1. TYPE. `MicConsent` cannot be constructed by callers, so `enableVoice()` is
//      unreachable without going through `askForMicConsent()`. A future caller that forgets
//      the prompt is a COMPILE error, not a runtime surprise. It does not stop someone
//      writing a deliberate cast — nothing at the type level can — but that is a visible,
//      reviewable act rather than an omission.
//   2. RUNTIME. A native dialog, in main, is the only shape that survives an arbitrary
//      bridge caller: a renderer-minted token would be a two-line defeat from the same
//      console and would prove nothing about a human having read the copy.
import { dialog, type BrowserWindow } from "electron"
import { VOICE_CONSENT_POINTS } from "../shared/voiceConsentCopy"

// Not exported as a constructible shape: the private field means no caller outside this
// module can produce a value of this type without an explicit cast.
export class MicConsent {
  private constructor(readonly at: string) {}
  /** Only askForMicConsent() reaches this. */
  private static create(): MicConsent {
    return new MicConsent(new Date().toISOString())
  }
  /** @internal — used by askForMicConsent only. */
  static __grant(): MicConsent {
    return MicConsent.create()
  }
}

/**
 * Asks the human. Returns true for an affirmative answer and false for ANY other outcome.
 * Injectable so the consent flow is testable headlessly — a native dialog blocks the main
 * process event loop and cannot run in a test. The seam is a main-process function
 * parameter: it is deliberately NOT reachable over IPC and NOT an env-var bypass, either of
 * which would simply become the new ungated enable path.
 */
export type ConsentAsker = (win: BrowserWindow | null) => Promise<boolean>

export const nativeConsentAsker: ConsentAsker = async (win) => {
  // Fail closed with no window: an unparented dialog can sit behind the app or never be
  // seen, and "the user did not answer" must never mean yes.
  if (!win || win.isDestroyed()) return false
  const DENY = 0
  const ALLOW = 1
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    buttons: ["Cancel", "Turn on the microphone"],
    // Esc and the window-close [X] both map to cancelId; the highlighted default is also
    // Cancel, so a stray Enter cannot grant consent.
    defaultId: DENY,
    cancelId: DENY,
    noLink: true,
    title: "Turn on always-on voice?",
    message: "June wants to turn on the wake-word microphone.",
    // Same copy the Settings panel shows — one constant, so the two can't drift.
    detail: VOICE_CONSENT_POINTS.map((p) => `• ${p}`).join("\n\n"),
  })
  // Anything that is not exactly the affirmative index is a denial.
  return response === ALLOW
}

// Single-flight. Without this, a loop of `voice.set(true)` invokes queues one modal per
// call: click-fatigue plus a stray Enter is a way to manufacture consent.
let pending: Promise<MicConsent | null> | null = null

// Bugbot PR #156. Asking is asynchronous, so the user can turn voice OFF while the dialog is
// still up — via the orb's kill switch, DevTools, or any bridge caller. Their most recent
// instruction wins, so a consent that was superseded mid-ask is NOT a consent.
//
// A generation counter rather than a mutex ON PURPOSE: serializing would make the kill switch
// queue behind an open modal, and blocking a privacy OFF switch is the one thing that must
// never happen. Disable stays immediate; a superseded ask resolves to null.
let epoch = 0

/**
 * Call on EVERY disable. Any consent currently being asked for — and any already-granted
 * consent still in flight back to its caller — is invalidated.
 */
export function invalidatePendingConsent(): void {
  epoch++
}

/**
 * Returns a MicConsent on an affirmative answer, or null on denial / no window / a throwing
 * asker / a disable that landed while asking. Callers MUST treat null as "do not enable" and
 * must not write any state first.
 */
// Known, accepted edge: a caller that JOINS an ask already invalidated by a disable also
// gets null, even though its own request came after that disable. It fails CLOSED (the user
// clicks Enable again), which is the correct direction for a privacy switch, and it is not
// reachable from the UI anyway — the dialog is window-modal, so a second enable can only come
// from another bridge caller.
export function askForMicConsent(
  win: BrowserWindow | null,
  asker: ConsentAsker = nativeConsentAsker,
): Promise<MicConsent | null> {
  if (pending) return pending
  const started = epoch
  pending = (async () => {
    try {
      const granted = await asker(win)
      // Re-check AFTER the await: a disable during the ask supersedes this answer.
      if (epoch !== started) return null
      return granted ? MicConsent.__grant() : null
    } catch {
      // A throwing asker (destroyed window, platform failure) is a denial. Never fail open.
      return null
    } finally {
      pending = null
    }
  })()
  return pending
}

/** Test-only: drop any in-flight ask so suites don't leak state into each other. */
export function __resetConsentForTests(): void {
  pending = null
}
