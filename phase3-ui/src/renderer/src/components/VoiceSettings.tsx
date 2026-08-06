// Voice master switch (NJ-57) — the entry point for enabling the always-on microphone.
//
// OFF by default. NJ-68 moved the CONSENT GATE itself into the main process: "Enable voice…"
// now calls voice.set(true), and main shows a NATIVE consent dialog before it writes anything
// or starts the daemon. This component no longer owns a React consent modal — it used to be
// the only thing enforcing consent, which meant anything else holding the preload bridge
// (DevTools, a compromised renderer dependency) could open the mic with no prompt at all.
// Keeping the React modal as well would now double-prompt, so the copy below is rendered as
// an always-visible disclosure instead: readable BEFORE you click, with the native dialog as
// the actual gate.
//
// Disabling needs no confirm — it KILLS the wake-daemon process, and the OS mic-in-use
// indicator disappearing is the user's own proof that listening actually ended.
import { useEffect, useState } from "react"
import { voice } from "../lib/voice"
import { VOICE_CONSENT_POINTS } from "../../../shared/voiceConsentCopy"

export function VoiceSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null) // null = loading
  // Stuck mic (Bugbot, PR #151): off was requested but the daemon's port still
  // answers — the UI must warn rather than present a clean "off".
  const [stillListening, setStillListening] = useState(false)
  // NJ-71: the capture process is actually alive, as opposed to merely preferred-on.
  const [micLive, setMicLive] = useState(false)
  // Bugbot PR #158: coming up (up to the 90s readiness window) is not a failure.
  const [micStarting, setMicStarting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const applyStatus = (s: {
      enabled: boolean
      running?: boolean
      starting?: boolean
      stillListening?: boolean
    }) => {
      // Bugbot PR #158: the mounted guard comes FIRST. I had setMicLive above it, so a late
      // voice.get() or onStatus callback landing after unmount would still write micLive
      // while skipping every other field — a torn update on a dead component.
      if (!mounted) return
      setEnabled(s.enabled)
      setMicLive(Boolean(s.running))
      setMicStarting(Boolean(s.starting))
      setStillListening(!s.enabled && Boolean(s.stillListening))
    }
    voice.get().then(applyStatus)
    const off = voice.onStatus(applyStatus)
    return () => {
      mounted = false
      off()
    }
  }, [])

  async function apply(next: boolean) {
    setBusy(true)
    setError(null)
    try {
      const s = await voice.set(next)
      setEnabled(s.enabled)
      setMicLive(Boolean(s.running))
      setMicStarting(Boolean(s.starting))
      setStillListening(!s.enabled && Boolean(s.stillListening))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="border-t border-nightjar-surface pt-4">
        <span className="text-xs font-semibold uppercase tracking-wide text-nightjar-text/60">Voice — “Hey June”</span>
        <p className="mt-1 text-[11px] leading-relaxed text-nightjar-text/50">
          Hands-free voice activation. <b>Off by default</b> — turning it on opens the microphone for as long as the
          app runs. Turning it off <b>kills the listening process</b>; watch your OS mic indicator go dark.
        </p>
      </div>

      {enabled === null ? (
        <p className="text-[11px] text-nightjar-text/40">Loading voice state…</p>
      ) : (
        <div className="flex items-center gap-3">
          <button
            // Both directions go straight to main. Enabling triggers main's native consent
            // dialog; declining it leaves the pref untouched and the button simply settles
            // back to "Enable voice…" (voice.set returns the unchanged status, not an error).
            onClick={() => void apply(!enabled)}
            disabled={busy}
            className={`rounded-md px-3 py-1.5 text-sm ${
              enabled
                ? "bg-nightjar-alert text-nightjar-base hover:brightness-110"
                : "bg-nightjar-accent text-nightjar-base hover:brightness-110"
            } disabled:opacity-40`}
          >
            {busy ? "applying…" : enabled ? "Turn voice off" : "Enable voice…"}
          </button>
          <span className="text-[11px] text-nightjar-text/50">
            {/* NJ-71 + Bugbot #158: FOUR states, not two. "enabled but not running" is real
                and was previously a confident "Mic is ON" while nothing listened — but it
                splits again into "coming up" (normal, up to the 90s readiness window) and
                "actually dead". Reporting a boot as a failure would be its own false alarm. */}
            {enabled && micLive
              ? "🎙 Mic is ON — listening for the wake word."
              : enabled && micStarting
                ? "Starting the listener… the mic is not open yet."
                : enabled
                  ? "⚠ Voice is on, but the listener is NOT running — no mic is open. See wake-daemon in the health strip."
                  : "Mic is off (process not running)."}
          </span>
        </div>
      )}

      {error && <p className="text-[11px] text-nightjar-alert">{error}</p>}

      {stillListening && (
        <p className="text-[11px] text-nightjar-alert">
          ⚠ Voice is off, but something is <b>still listening</b> on the voice port — the previous listener could not
          be stopped, so the mic may still be live. Check the health strip (wake-daemon) or stop that process manually;
          your OS mic indicator tells the truth.
        </p>
      )}

      {/* Always visible, not a modal (NJ-68): the authoritative ask is main's native dialog,
          so this is the disclosure you can read BEFORE clicking rather than a second prompt
          on top of the first. Shown only while voice is off — once it's on, the terms have
          been accepted and the panel's job is the kill switch. */}
      {enabled === false && (
        <div className="rounded-md border border-nightjar-surface bg-nightjar-surface/30 px-3 py-2">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-nightjar-text/60">
            Before you turn this on
          </p>
          {VOICE_CONSENT_POINTS.map((p, i) => (
            <p key={i} className="text-[11px] leading-relaxed text-nightjar-text/70">
              • {p}
            </p>
          ))}
          <p className="mt-1.5 text-[11px] text-nightjar-text/50">
            Your operating system will ask you to confirm before the microphone opens.
          </p>
        </div>
      )}
    </div>
  )
}
