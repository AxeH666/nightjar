import { useState, type ReactNode } from "react"
import { useProjects } from "../../lib/projects"
import { useProjectContent, type ProjectContent } from "../../lib/projectContent"
import type { LabId } from "./labs"

// A project's home (Lab.md §4.6): the breadcrumb + the three per-project areas — Memory,
// Instructions, and Files — now REAL and editable (persisted per project). Wiring
// Instructions into the lab agent's prompt and isolating this project's chats (sessions
// keyed by (slot, projectId)) is the next PR; it needs live session work + on-device
// verification (rules 6/8), so it's called out here rather than faked.
export function ProjectView({ labId, projectId, onBack }: { labId: LabId; projectId: string; onBack: () => void }) {
  const store = useProjects(labId)
  const project = store.get(projectId)
  const content = useProjectContent(projectId)

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
          <Panel emoji="📋" title="Instructions" note="Prepended to the lab agent's prompt for this project's chats (wired in the next step).">
            <textarea
              value={content.instructions}
              onChange={(e) => content.setInstructions(e.target.value)}
              placeholder="e.g. Act as my technical co-founder and systems architect…"
              rows={4}
              className="w-full resize-y rounded-lg bg-nightjar-surface px-3 py-2 text-sm text-nightjar-text placeholder:text-nightjar-text/30 focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
            />
          </Panel>

          <Panel emoji="💾" title="Memory" note="Durable context for this project. Private to you.">
            <textarea
              value={content.memory}
              onChange={(e) => content.setMemory(e.target.value)}
              placeholder="Notes this project should remember across chats…"
              rows={4}
              className="w-full resize-y rounded-lg bg-nightjar-surface px-3 py-2 text-sm text-nightjar-text placeholder:text-nightjar-text/30 focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
            />
          </Panel>

          <Panel emoji="📎" title="Files" note="Reference snippets the agent can draw on within this project (distinct from generated Downloads).">
            <FilesEditor content={content} />
          </Panel>

          <p className="text-center text-xs text-nightjar-text/30">
            This project's chats become isolated, and Instructions start reaching the agent, in the next update.
          </p>
        </div>
      </div>
    </div>
  )
}

function Panel({ emoji, title, note, children }: { emoji: string; title: string; note: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-nightjar-surface bg-nightjar-surface/20 p-4">
      <div className="font-medium text-nightjar-text">
        {emoji} {title}
      </div>
      <p className="mb-2 text-xs text-nightjar-text/40">{note}</p>
      {children}
    </div>
  )
}

function FilesEditor({ content }: { content: ProjectContent }) {
  const [name, setName] = useState("")
  const [body, setBody] = useState("")

  function add() {
    if (!name.trim() && !body.trim()) return
    content.addFile(name, body)
    setName("")
    setBody("")
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 rounded-lg border border-nightjar-surface/60 p-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Reference name (e.g. spec.md)"
          className="rounded bg-nightjar-surface px-2 py-1 text-sm text-nightjar-text placeholder:text-nightjar-text/30 focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Paste reference text…"
          rows={3}
          className="resize-y rounded bg-nightjar-surface px-2 py-1 text-sm text-nightjar-text placeholder:text-nightjar-text/30 focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
        />
        <button
          onClick={add}
          disabled={!name.trim() && !body.trim()}
          className="self-start rounded-lg bg-nightjar-accent px-3 py-1 text-xs font-medium text-nightjar-base hover:brightness-110 disabled:opacity-40"
        >
          Add reference
        </button>
      </div>

      {content.files.length === 0 ? (
        <p className="text-xs text-nightjar-text/30">No references yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {content.files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded border border-nightjar-surface/60 px-2 py-1 text-sm">
              <span aria-hidden>📄</span>
              <span className="flex-1 truncate text-nightjar-text/80" title={f.content}>
                {f.name}
              </span>
              <button
                onClick={() => content.removeFile(f.id)}
                title="Remove"
                className="text-nightjar-text/40 hover:text-nightjar-alert"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
