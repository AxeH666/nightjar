// Voice master switch (NJ-57) — the ONLY way to enable the always-on microphone.
//
// OFF by default. Enabling always goes through the consent modal below (every enable,
// not just the first — ephemeral like LocalModeNotice, no "don't show again"): an open
// microphone is consequential enough that the ask should never be skippable state.
// Disabling needs no confirm — it KILLS the wake-daemon process, and the OS mic-in-use
// indicator disappearing is the user's own proof that listening actually ended.
import { useEffect, useState } from "react"
import { voice } from "../lib/voice"

// The consent copy, one constant so it stays reviewable and honest. Mirrors the
// CloudBanner invariant: the cloud-egress consequence is stated plainly — a voice
// command goes to the ACTIVE CHAT MODEL, which is a cloud provider when the global
// toggle is Cloud.
export const VOICE_CONSENT_POINTS: string[] = [
  "While voice is on and the app is open, the microphone is captured continuously so June can hear the wake word.",
  "Wake-word scoring and speech-to-text run locally, in memory — mic audio is not saved to disk.",
  "Your spoken command goes to the active chat model. If the Local/Cloud toggle is Cloud, that command leaves your machine to the cloud provider.",
  "Turning voice off kills the listening process — your OS's mic-in-use indicator going dark is the proof.",
  "Quitting the app closes the microphone; there is no background service.",
]

export function VoiceSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null) // null = loading
  // Stuck mic (Bugbot, PR #151): off was requested but the daemon's port still
  // answers — the UI must warn rather than present a clean "off".
  const [stillListening, setStillListening] = useState(false)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    const applyStatus = (s: { enabled: boolean; stillListening?: boolean }) => {
      if (!mounted) return
      setEnabled(s.enabled)
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
      setStillListening(!s.enabled && Boolean(s.stillListening))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      setAsking(false)
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
            onClick={() => (enabled ? void apply(false) : setAsking(true))}
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
            {enabled ? "🎙 Mic is ON — listening for the wake word." : "Mic is off (process not running)."}
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

      {asking && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-[460px] max-w-[92vw] rounded-xl border border-nightjar-surface bg-nightjar-base shadow-2xl">
            <div className="flex items-center gap-2 border-b border-nightjar-surface px-5 py-3">
              <span className="text-sm font-semibold text-nightjar-text">🎙 Turn on always-listening voice?</span>
            </div>
            <div className="space-y-2 px-5 py-4">
              {VOICE_CONSENT_POINTS.map((p, i) => (
                <p key={i} className="text-[13px] leading-relaxed text-nightjar-text/80">
                  • {p}
                </p>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-nightjar-surface px-5 py-3">
              <button
                onClick={() => setAsking(false)}
                className="rounded-md px-4 py-1.5 text-sm text-nightjar-text/70 hover:bg-nightjar-surface"
              >
                Cancel
              </button>
              <button
                onClick={() => void apply(true)}
                disabled={busy}
                className="rounded-md bg-nightjar-accent px-4 py-1.5 text-sm font-medium text-nightjar-base hover:brightness-110 disabled:opacity-40"
              >
                {busy ? "starting…" : "Enable microphone"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
