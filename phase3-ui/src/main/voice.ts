// Nightjar voice master switch — main process only (NJ-57).
//
// An always-on wake-word microphone is privacy-consequential, so it is OPT-IN and OFF
// by default: the wake daemon is only ever spawned when this pref says enabled (the
// supervisor's `enabled()` gate reads it), and disabling KILLS the capture process —
// never a soft-mute — so the OS mic-in-use indicator is the user's source of truth.
// Rule-1 note: the mic is not an agent tool, so the `permission` field isn't the gate
// here — the gate is this app-level opt-in bound to process lifecycle (the agent-side
// half is the deliberate voice-tool denial recorded in engine-workspace/opencode.json).
//
// Persisted like capability-prefs.json (userData/voice-pref.json, plain JSON at 0600 —
// no secrets, just {enabled, consentedAt}). consentedAt records when the user last
// accepted the consent prompt, for honesty in support/debugging — it is not a
// "skip the prompt" flag (consent is asked on every enable, by design).
import { app } from "electron"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import type { MicConsent } from "./voiceConsent"

export interface VoicePref {
  enabled: boolean
  consentedAt?: string // ISO timestamp of the first accepted consent
}

const DEFAULT_PREF: VoicePref = { enabled: false }

function storePath(): string {
  return join(app.getPath("userData"), "voice-pref.json")
}

function readStore(): VoicePref {
  try {
    const raw = JSON.parse(readFileSync(storePath(), "utf8"))
    if (raw && typeof raw === "object" && typeof raw.enabled === "boolean") {
      return { enabled: raw.enabled, ...(typeof raw.consentedAt === "string" ? { consentedAt: raw.consentedAt } : {}) }
    }
  } catch {
    /* absent/corrupt → default OFF (never fail open on a privacy switch) */
  }
  return { ...DEFAULT_PREF }
}

export function getVoicePref(): VoicePref {
  return readStore()
}

export function getVoiceEnabled(): boolean {
  return readStore().enabled
}

function write(next: VoicePref): VoicePref {
  const p = storePath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(next, null, 2), { mode: 0o600 })
  return next
}

// NJ-68: enabling the mic REQUIRES a MicConsent, which only askForMicConsent() can produce.
// This is the compile-time half of the gate — the old `setVoiceEnabled(boolean)` let any
// caller flip the switch, and its single caller (the voice:set handler) was trusting a
// renderer-side modal that nothing in main enforced. Splitting enable from disable also
// keeps the kill switch a zero-argument call that can never fail to typecheck.
//
// consentedAt is now stamped from the VERIFIED consent on every enable, so it means "when
// the user last consented". It used to be stamped once on the first enable ever and never
// refreshed, which made it wrong after any toggle cycle. It still has no reader in the UI —
// tracked as NJ-69.
export function enableVoice(consent: MicConsent): VoicePref {
  return write({ enabled: true, consentedAt: consent.at })
}

export function disableVoice(): VoicePref {
  const cur = readStore()
  const next: VoicePref = { enabled: false, ...(cur.consentedAt ? { consentedAt: cur.consentedAt } : {}) }
  return write(next)
}
