import type { ModelChoice } from "../lib/byok"

// Unmissable indicator that the active model is a CLOUD model — data leaves the
// machine, breaking Nightjar's default offline/local-first promise. Deliberately
// loud (full-width rust/amber bar with an icon), not a subtle dot. Renders
// nothing when the local model is active (the default, safe state).
export function CloudBanner({ model, onSwitchLocal }: { model: ModelChoice; onSwitchLocal: () => void }) {
  if (model.local) return null
  return (
    <div
      role="alert"
      className="flex items-center gap-3 border-b border-nightjar-alert bg-nightjar-alert/90 px-4 py-2 text-sm text-nightjar-text"
    >
      <span className="text-base">☁</span>
      <span className="font-semibold uppercase tracking-wide">Cloud model active</span>
      <span className="text-nightjar-text/90">
        Messages are sent to <b>{model.providerName}</b> — data leaves your machine (not local/offline).
      </span>
      <button
        onClick={onSwitchLocal}
        className="ml-auto rounded border border-nightjar-text/40 px-2 py-0.5 text-xs font-medium hover:bg-nightjar-text/10"
      >
        Switch to local
      </button>
    </div>
  )
}
