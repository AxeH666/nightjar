import { useRef, useState, type ReactNode } from "react"
import { useProjects, type ProjectScope } from "../../lib/projects"
import { useProjectContent, type ProjectContent, type SaveResult } from "../../lib/projectContent"
import { memoryStaleness } from "../../lib/autoMemory"
import { useSessions } from "../../context/SessionsContext"
import { useConnection } from "../../context/ConnectionContext"
import { ProjectChat } from "./ProjectChat"

// A project's home (Lab.md §4.6): the breadcrumb, a per-project Chat (5b — isolated to this
// project's own OpenCode session), and the three Knowledge areas — Instructions, Memory, and
// Files (persisted per project). Chat is the primary surface; Knowledge holds the project's
// durable context. Instructions, manual Notes, and auto Memory (PR-C..AM-2) reach the agent as system
// context, gated by per-project cloud consent so they never egress to a cloud model without opt-in;
// Files do not yet.
export function ProjectView({ scope, projectId, onBack }: { scope: ProjectScope; projectId: string; onBack: () => void }) {
  const store = useProjects(scope)
  // Read from `projects` state, NOT store.get(): `get` is memoized against the ref with an
  // empty dep array, so it only reflects a rename incidentally (because mutate also
  // re-renders). Reading state directly makes the name genuinely reactive — which matters
  // now that this view can rename in place.
  const project = store.projects.find((p) => p.id === projectId)
  const content = useProjectContent(projectId)
  const [tab, setTab] = useState<"chat" | "knowledge">("chat")

  const tabBtn = (active: boolean): string =>
    `rounded px-3 py-1 text-xs ${active ? "bg-nightjar-accent text-nightjar-base" : "text-nightjar-text/60 hover:text-nightjar-text"}`

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
        {project ? (
          <ProjectTitle name={project.name} onRename={(v) => store.rename(project.id, v)} />
        ) : (
          <span className="font-medium text-nightjar-text">Project</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button className={tabBtn(tab === "chat")} onClick={() => setTab("chat")}>
            Chat
          </button>
          <button className={tabBtn(tab === "knowledge")} onClick={() => setTab("knowledge")}>
            Knowledge
          </button>
        </div>
      </div>

      {/* Chat stays MOUNTED across a tab switch (hidden, not unmounted) so switching to Knowledge
          and back doesn't tear down the session or lose scroll/streaming state. */}
      <div className={tab === "chat" ? "min-h-0 flex-1" : "hidden"}>
        {/* Instructions + Notes + auto Memory come from this view's LIVE content, so both the chat's
            cloud-consent banner AND its send-time injection use the same values the user sees —
            reacting immediately to Knowledge-tab edits, with no live-vs-storage divergence (PR-C..AM-2). */}
        <ProjectChat
          projectId={projectId}
          instructions={content.instructions}
          memory={content.memory}
          autoMemory={content.autoMemory}
        />
      </div>

      <div className={tab === "knowledge" ? "min-h-0 flex-1 overflow-y-auto p-6" : "hidden"}>
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <Panel
            emoji="📋"
            title="Instructions"
            optional
            save={content.saveState.instructions}
            note="If set, sent as system context on this project's chats. Local models always; a cloud model only after you allow it for this project. Leave empty and the project works exactly the same."
          >
            <textarea
              value={content.instructions}
              onChange={(e) => content.setInstructions(e.target.value)}
              placeholder="Optional — how the agent should behave in this project"
              rows={4}
              className="w-full resize-y rounded-lg bg-nightjar-surface px-3 py-2 text-sm text-nightjar-text placeholder:text-nightjar-text/30 focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
            />
          </Panel>

          <Panel
            emoji="📝"
            title="Notes"
            optional
            save={content.saveState.memory}
            note="Your own durable notes for this project, sent to its chats as system context (same cloud gate as Instructions). Never overwritten by auto-memory. Private to you."
          >
            <textarea
              value={content.memory}
              onChange={(e) => content.setMemory(e.target.value)}
              placeholder="Notes this project should remember across chats…"
              rows={4}
              className="w-full resize-y rounded-lg bg-nightjar-surface px-3 py-2 text-sm text-nightjar-text placeholder:text-nightjar-text/30 focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
            />
          </Panel>

          <AutoMemoryPanel projectId={projectId} content={content} />

          <Panel
            emoji="📎"
            title="Files"
            optional
            save={content.saveState.files}
            note="Reference snippets the agent can draw on within this project (distinct from generated Downloads)."
          >
            <FilesEditor content={content} />
          </Panel>

          <p className="text-center text-xs text-nightjar-text/30">
            The Chat tab is isolated to this project. Instructions, Notes and Memory guide its chats (cloud models need your per-project OK); Files don't reach the agent yet.
          </p>
        </div>
      </div>
    </div>
  )
}

// Inline-editable project title. Mirrors the ProjectCard rename pattern (click to edit, Enter
// commits, Escape discards, blur commits) including the cancelRef guard — unmounting the
// focused input still fires onBlur, so Escape needs that flag to genuinely discard.
//
// This is REQUIRED, not a nicety: creating a project auto-navigates straight into it, so once
// a nameless create is allowed you would otherwise land inside "Untitled project" with no way
// to name it without going back to the grid and finding it among identically-named cards.
function ProjectTitle({ name, onRename }: { name: string; onRename: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const cancelRef = useRef(false)

  function commit() {
    if (cancelRef.current) {
      cancelRef.current = false
      setEditing(false)
      return
    }
    onRename(draft)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        onClick={() => {
          setDraft(name) // start from the current name, never a stale edit
          setEditing(true)
        }}
        title="Rename project"
        className="rounded px-1 font-medium text-nightjar-text hover:bg-nightjar-surface"
      >
        {name}
      </button>
    )
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit()
        if (e.key === "Escape") {
          cancelRef.current = true // suppress the onBlur-on-unmount commit
          setDraft(name)
          setEditing(false)
        }
      }}
      onBlur={commit}
      className="rounded bg-nightjar-base px-1 font-medium text-nightjar-text focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
    />
  )
}

// Reports what the last write to this part ACTUALLY did. Never renders an unearned "Saved":
// `save` is undefined until something has been written, and a failed write says so plainly.
function SaveChip({ save }: { save: SaveResult }) {
  return save.ok ? (
    <span className="ml-auto text-[11px] text-nightjar-text/40" title="Saved on this device">
      Saved
    </span>
  ) : (
    <span
      className="ml-auto text-[11px] font-medium text-nightjar-alert"
      title="Browser storage is full or unavailable — this edit exists in memory only and will be lost when the app closes."
    >
      Not saved
    </span>
  )
}

function Panel({
  emoji,
  title,
  note,
  optional,
  save,
  children,
}: {
  emoji: string
  title: string
  note: string
  optional?: boolean
  save?: SaveResult
  children: ReactNode
}) {
  return (
    <div className="rounded-xl border border-nightjar-surface bg-nightjar-surface/20 p-4">
      <div className="flex items-center gap-2">
        <span className="font-medium text-nightjar-text">
          {emoji} {title}
        </span>
        {optional && (
          <span className="rounded bg-nightjar-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-nightjar-text/40">
            Optional
          </span>
        )}
        {save && <SaveChip save={save} />}
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
        <div className="flex items-center gap-2">
          <button
            onClick={add}
            disabled={!name.trim() && !body.trim()}
            className="self-start rounded-lg bg-nightjar-accent px-3 py-1 text-xs font-medium text-nightjar-base hover:brightness-110 disabled:opacity-40"
          >
            Add reference
          </button>
          {/* Unlike Instructions/Memory (persisted per keystroke), this composer is local
              component state — navigating away discards it. It is the one genuinely unsaved
              edit in this view, so it says so instead of looking saved. */}
          {(name.trim() || body.trim()) && (
            <span className="text-[11px] text-nightjar-text/40">Not added yet — click Add reference</span>
          )}
        </div>
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

// Coarse relative time for the "last updated" line (renderer Date.now() is fine here).
function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

// The Memory panel with auto-generation (AM-2b): edit the durable memory directly, or Regenerate it
// from the project's chats on the LOCAL model. Regeneration NEVER overwrites — it stages a proposal
// the user Accepts or Discards, so hand-edits (and manual Notes) are always safe. A count-based
// "N new chats since" hint nudges (never auto-regenerates); generation is local so nothing egresses.
function AutoMemoryPanel({ projectId, content }: { projectId: string; content: ProjectContent }) {
  const { summarizeProjectChats, projectChatIds } = useSessions()
  const { connected } = useConnection()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chatCount = (projectChatIds[projectId] ?? []).length
  const proposal = content.autoMemoryProposal
  const { stale, newChats } = memoryStaleness({ generatedChatCount: content.memoryMeta?.sourceChatCount ?? 0, currentChatCount: chatCount })

  async function regenerate() {
    setBusy(true)
    setError(null)
    const res = await summarizeProjectChats(projectId, content.autoMemory)
    setBusy(false)
    if (res.ok) content.setMemoryProposal(res.summary, res.chatCount, res.coveredCount)
    else setError(res.error)
  }

  return (
    <Panel
      emoji="💾"
      title="Memory"
      optional
      save={content.saveState.autoMemory}
      note="Durable memory for this project, sent to its chats (same cloud gate). Generated on-device from your chats (never sent to the cloud) — or edit it yourself. Private to you."
    >
      <textarea
        value={content.autoMemory}
        onChange={(e) => content.setAutoMemory(e.target.value)}
        placeholder="What this project has learned — a durable summary. Edit here, or Regenerate from your chats…"
        rows={4}
        className="w-full resize-y rounded-lg bg-nightjar-surface px-3 py-2 text-sm text-nightjar-text placeholder:text-nightjar-text/30 focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
      />
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <button
          onClick={regenerate}
          disabled={busy || !connected || chatCount === 0}
          title={chatCount === 0 ? "This project has no chats to summarise yet" : !connected ? "Connect to the engine first" : "Summarise this project's chats on the local model"}
          className="rounded-lg bg-nightjar-accent px-3 py-1 font-medium text-nightjar-base hover:brightness-110 disabled:opacity-40"
        >
          {busy ? "Summarising…" : "Regenerate from chats"}
        </button>
        {content.memoryMeta && !busy && <span className="text-nightjar-text/40">Updated {relTime(content.memoryMeta.lastGeneratedAt)}</span>}
        {!busy && !proposal && stale && content.memoryMeta && (
          <span className="text-nightjar-accent">
            {newChats} new chat{newChats > 1 ? "s" : ""} since — regenerate?
          </span>
        )}
        {error && <span className="text-nightjar-alert">{error}</span>}
      </div>

      {proposal && (
        <div className="mt-3 rounded-lg border border-nightjar-accent/50 bg-nightjar-accent/5 p-2">
          <p className="mb-1 text-xs font-medium text-nightjar-text/70">Proposed memory — review before it replaces the current one:</p>
          {proposal.coveredCount < proposal.chatCount && (
            <p className="mb-1 text-[11px] text-nightjar-alert">
              ⚠ Based on {proposal.coveredCount} of {proposal.chatCount} chats (older/longer ones didn't fit).
            </p>
          )}
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-sm text-nightjar-text/80">{proposal.text}</pre>
          <div className="mt-2 flex gap-2">
            <button
              onClick={content.acceptMemoryProposal}
              className="rounded-lg bg-nightjar-accent px-3 py-1 text-xs font-medium text-nightjar-base hover:brightness-110"
            >
              Accept
            </button>
            <button
              onClick={content.discardMemoryProposal}
              className="rounded-lg border border-nightjar-surface px-3 py-1 text-xs font-medium text-nightjar-text/70 hover:bg-nightjar-surface"
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </Panel>
  )
}
