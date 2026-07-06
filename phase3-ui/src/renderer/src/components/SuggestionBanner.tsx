// Non-blocking, rules-based suggestion that a different mode may fit. Never
// switches on its own — the user clicks to accept.
export function SuggestionBanner({
  suggested,
  onAccept,
  onDismiss,
}: {
  suggested: string
  onAccept: () => void
  onDismiss: () => void
}) {
  return (
    <div className="flex items-center gap-2 border-b border-nightjar-accent/30 bg-nightjar-accent/10 px-4 py-1.5 text-sm">
      <span className="text-nightjar-accent">◆</span>
      <span className="text-nightjar-text/80">
        This looks like a <span className="font-medium capitalize text-nightjar-accent">{suggested}</span> task.
      </span>
      <button onClick={onAccept} className="ml-1 rounded bg-nightjar-accent px-2 py-0.5 text-xs font-medium text-nightjar-base hover:brightness-110">
        Switch to {suggested}
      </button>
      <button onClick={onDismiss} className="ml-auto text-nightjar-text/40 hover:text-nightjar-text/70" title="Dismiss">✕</button>
    </div>
  )
}
