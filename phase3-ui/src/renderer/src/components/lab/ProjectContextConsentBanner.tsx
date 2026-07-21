// Per-project cloud-egress consent for a project's KNOWLEDGE (Instructions + Memory). Shown ONLY when
// a project chat has some knowledge, the active model is CLOUD, and the user hasn't consented for this
// project. Until they do, the send omits ALL of it (the chat still works). The two actions ARE the
// resolution: Allow (opt in, persisted per-project) or Switch to local (no egress). Layered above the
// generic CloudBanner, which already flags that chat text itself leaves. role="status" (a standing
// notice), not "alert".
export function ProjectContextConsentBanner({
  provider,
  onAllow,
  onSwitchLocal,
}: {
  provider: string
  onAllow: () => void
  onSwitchLocal: () => void
}) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-nightjar-alert bg-nightjar-alert/90 px-4 py-2 text-sm text-nightjar-text"
    >
      <span className="text-base" aria-hidden>
        ☁
      </span>
      <span className="text-nightjar-text/90">
        This project's <b>Instructions &amp; Memory</b> are being withheld from <b>{provider}</b> — a cloud model. Send them for this project?
      </span>
      <button
        onClick={onAllow}
        className="ml-auto rounded border border-nightjar-text/40 px-2 py-0.5 text-xs font-medium hover:bg-nightjar-text/10"
      >
        Allow for this project
      </button>
      <button
        onClick={onSwitchLocal}
        className="rounded border border-nightjar-text/40 px-2 py-0.5 text-xs font-medium hover:bg-nightjar-text/10"
      >
        Switch to local
      </button>
    </div>
  )
}
