import { useProjects } from "../../lib/projects"
import type { LabId } from "./labs"

// A project's scoped workspace (Lab.md §4.6). In this PR it's the project HOME — the
// breadcrumb + the three per-project areas (Memory / Instructions / Files) as labeled
// placeholders. The next PR fills them in and scopes this project's chats (sessions keyed by
// (slot, projectId)), so these placeholders become the real per-project workspace.
export function ProjectView({ labId, projectId, onBack }: { labId: LabId; projectId: string; onBack: () => void }) {
  const store = useProjects(labId)
  const project = store.get(projectId)

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-nightjar-surface px-4 py-2">
        <button
          onClick={onBack}
          title="Back to Projects"
          className="rounded px-2 py-1 text-xs text-nightjar-text/50 hover:bg-nightjar-surface hover:text-nightjar-text"
        >
          ‹ Projects
        </button>
        <span className="font-medium text-nightjar-text">{project?.name ?? "Project"}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <Section emoji="💾" title="Memory" note="This project's memory builds from its own chats. Private to you." />
          <Section emoji="📋" title="Instructions" note="Per-project instructions, prepended to the lab agent's prompt for every chat in this project." />
          <Section emoji="📎" title="Files" note="Reference files the agent can draw on within this project (distinct from generated Downloads)." />
          <p className="text-center text-xs text-nightjar-text/30">
            These become editable and this project's chats become isolated in the next update.
          </p>
        </div>
      </div>
    </div>
  )
}

function Section({ emoji, title, note }: { emoji: string; title: string; note: string }) {
  return (
    <div className="rounded-xl border border-nightjar-surface bg-nightjar-surface/20 p-4">
      <div className="mb-1 font-medium text-nightjar-text">
        {emoji} {title}
      </div>
      <p className="text-sm text-nightjar-text/40">{note}</p>
    </div>
  )
}
