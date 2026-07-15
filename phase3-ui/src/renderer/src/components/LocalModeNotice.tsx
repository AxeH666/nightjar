// "Switched to Local" limitations popup (Task 2). Appears EVERY time the user switches
// the global toggle to Local — the trigger lives in the toggle handler (CapabilitiesSettings
// goLocal), fires only on the transition INTO Local, and there is NO localStorage / "don't
// show again": the state is ephemeral, so it reappears on the next switch, by design.
//
// Reuses the BYOK modal shell. Sits above the settings modal (z-[60] > z-50) so it's
// visible even when triggered from inside Settings.

// The copy, kept in one constant so it's easy to extend and stays honest about the
// post-toggle behavior (offline image has no backend wired yet; local research/web-search
// can be slow). EXACT wording per the v1 plan.
export const LOCAL_MODE_NOTICE =
  "Image generation is unavailable offline (no local model wired yet). Deep research and web search may be slow or fail on the local model."

export function LocalModeNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[420px] max-w-[92vw] rounded-xl border border-nightjar-surface bg-nightjar-base shadow-2xl">
        <div className="flex items-center gap-2 border-b border-nightjar-surface px-5 py-3">
          <span className="text-sm font-semibold text-nightjar-text">🔒 Switched to Local</span>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm leading-relaxed text-nightjar-text/80">{LOCAL_MODE_NOTICE}</p>
        </div>
        <div className="flex justify-end border-t border-nightjar-surface px-5 py-3">
          <button
            onClick={onDismiss}
            className="rounded-md bg-nightjar-accent px-4 py-1.5 text-sm font-medium text-nightjar-base hover:brightness-110"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
