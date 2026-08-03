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
// no secrets, just {enabled, consentedAt}). consentedAt records the first time the
// user accepted the consent modal, for honesty in support/debugging — it is not a
// "skip the modal" flag (the renderer shows consent on every enable, by design).
import { app } from "electron"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"

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

export function setVoiceEnabled(enabled: boolean): VoicePref {
  const cur = readStore()
  const next: VoicePref = {
    enabled: Boolean(enabled),
    ...(cur.consentedAt || !enabled ? { consentedAt: cur.consentedAt } : { consentedAt: new Date().toISOString() }),
  }
  if (!next.consentedAt) delete next.consentedAt
  const p = storePath()
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, JSON.stringify(next, null, 2), { mode: 0o600 })
  return next
}
