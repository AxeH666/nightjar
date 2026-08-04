// The mic-consent copy, in ONE place (NJ-68).
//
// It lives in src/shared because both surfaces must say the same thing: the native consent
// dialog in the main process (src/main/voiceConsent.ts — the authoritative gate) and the
// always-visible disclosure in Settings (src/renderer/.../VoiceSettings.tsx). Two hand-kept
// copies of privacy copy is exactly how one of them ends up quietly out of date.
//
// Mirrors the CloudBanner invariant: the cloud-egress consequence is stated plainly — a
// spoken command goes to the ACTIVE CHAT MODEL, which is a cloud provider when the global
// Local/Cloud toggle is Cloud.
export const VOICE_CONSENT_POINTS: readonly string[] = [
  "While voice is on and the app is open, the microphone is captured continuously so June can hear the wake word.",
  "Wake-word scoring and speech-to-text run locally, in memory — mic audio is not saved to disk.",
  "Your spoken command goes to the active chat model. If the Local/Cloud toggle is Cloud, that command leaves your machine to the cloud provider.",
  "Turning voice off kills the listening process — your OS's mic-in-use indicator going dark is the proof.",
  "Quitting the app closes the microphone; there is no background service.",
] as const
