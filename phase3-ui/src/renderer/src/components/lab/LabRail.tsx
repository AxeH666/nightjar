import type { SlotId } from "../../context/SessionsContext"
import { SessionList } from "../SessionList"
import type { LabDef } from "./labs"

// The shared left navigation rail (Lab.md §4.1): a back-to-launcher breadcrumb, the per-lab
// Chats history (the generalized SessionList — resumable, scoped to this lab's slot),
// Projects (per-lab, §4.6 — lands in the next PRs), and Settings (opens the existing app
// settings modal). A coming-soon lab has no live slot, so it passes no `history` and the
// Chats area shows an honest placeholder rather than a dead list (CLAUDE.md rule 8).
export interface LabHistory {
  slot: SlotId
  agent: string
  sessionIds: Set<string>
  activeId: string
}

export function LabRail({
  lab,
  history,
  onBack,
  onOpenSettings,
  onOpenProjects,
}: {
  lab: LabDef
  history?: LabHistory
  onBack: () => void
  onOpenSettings: () => void
  // When provided, the Projects entry is live and opens the lab's Projects home; a lab that
  // isn't built yet omits it and the entry stays a disabled "soon" placeholder (rule 8).
  onOpenProjects?: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 p-2">
        <button
          onClick={onBack}
          title="Back to the lab launcher"
          className="mb-2 flex items-center gap-1 rounded px-2 py-1 text-xs text-nightjar-text/50 hover:bg-nightjar-surface hover:text-nightjar-text"
        >
          ‹ Labs
        </button>
        <div className="flex items-center gap-2 px-2">
          <span aria-hidden>{lab.emoji}</span>
          <span className="font-medium text-nightjar-text">{lab.label}</span>
        </div>
      </div>

      {/* Chats — the resumable per-lab history, fills the middle */}
      <div className="min-h-0 flex-1">
        {history ? (
          <SessionList
            slot={history.slot}
            agent={history.agent}
            sessionIds={history.sessionIds}
            activeId={history.activeId}
            label="Chats"
            newTitle="New chat"
            chrome={false}
          />
        ) : (
          <div className="px-3 py-2 text-xs text-nightjar-text/30">💬 Chats appear once this lab is live.</div>
        )}
      </div>

      {/* Projects + Settings pinned at the bottom */}
      <div className="shrink-0 border-t border-nightjar-surface p-2 text-sm">
        {onOpenProjects ? (
          <button
            onClick={onOpenProjects}
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-nightjar-text/70 hover:bg-nightjar-surface"
          >
            📁 Projects
          </button>
        ) : (
          <button
            disabled
            title="Per-lab Projects — coming soon"
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-nightjar-text/30"
          >
            📁 Projects <span className="ml-auto text-[10px] uppercase tracking-wide">soon</span>
          </button>
        )}
        <button
          onClick={onOpenSettings}
          className="mt-1 flex w-full items-center gap-2 rounded px-2 py-1 text-left text-nightjar-text/70 hover:bg-nightjar-surface"
        >
          ⚙ Settings
        </button>
      </div>
    </div>
  )
}
