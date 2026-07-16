import type { LabDef } from "./labs"

// The shared left navigation rail (Lab.md §4.1): a back-to-launcher breadcrumb, then
// Chats (per-lab conversation history), Projects (per-lab, §4.6), and Settings. The
// resumable Chats LIST is generalized from the code SessionList in the next PR, and the
// Projects system lands after that — so both show honest placeholders here rather than
// dead controls (CLAUDE.md rule 8). Settings opens the existing app settings modal.
export function LabRail({
  lab,
  onBack,
  onOpenSettings,
}: {
  lab: LabDef
  onBack: () => void
  onOpenSettings: () => void
}) {
  return (
    <div className="flex h-full flex-col p-2 text-sm">
      <button
        onClick={onBack}
        title="Back to the lab launcher"
        className="mb-2 flex items-center gap-1 rounded px-2 py-1 text-xs text-nightjar-text/50 hover:bg-nightjar-surface hover:text-nightjar-text"
      >
        ‹ Labs
      </button>
      <div className="mb-3 flex items-center gap-2 px-2">
        <span aria-hidden>{lab.emoji}</span>
        <span className="font-medium text-nightjar-text">{lab.label}</span>
      </div>

      <div className="px-2 text-xs uppercase tracking-wide text-nightjar-text/40">💬 Chats</div>
      <p className="mb-3 mt-1 px-2 text-xs text-nightjar-text/40">
        This conversation. Resumable chat history arrives next.
      </p>

      <button
        disabled
        title="Per-lab Projects — coming soon"
        className="flex items-center gap-2 rounded px-2 py-1 text-left text-nightjar-text/30"
      >
        📁 Projects <span className="ml-auto text-[10px] uppercase tracking-wide">soon</span>
      </button>

      <div className="my-2 border-t border-nightjar-surface" />
      <button
        onClick={onOpenSettings}
        className="flex items-center gap-2 rounded px-2 py-1 text-left text-nightjar-text/70 hover:bg-nightjar-surface"
      >
        ⚙ Settings
      </button>
    </div>
  )
}
