import { useMemo, useRef, useState } from "react"
import { useProjects, type Project, type ProjectsStore } from "../../lib/projects"
import { labById, type LabId } from "./labs"

// Projects home (Lab.md §4.6): a grid of the lab's project cards with New project, search,
// and sort (favorites first, then Last-updated or Name). Managing projects
// (rename/duplicate/delete/favorite) lives here; opening a project into its scoped workspace
// (chats + Memory/Instructions/Files) is the next PR.
function fmtWhen(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function ProjectsHome({
  labId,
  onBack,
  onOpen,
}: {
  labId: LabId
  onBack: () => void
  onOpen: (projectId: string) => void
}) {
  const store = useProjects(labId)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<"updated" | "name">("updated")
  const [newName, setNewName] = useState("")

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? store.projects.filter((p) => p.name.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q))
      : store.projects
    return [...filtered].sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1 // favorites first
      return sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt - a.updatedAt
    })
  }, [store.projects, query, sort])

  function submitNew() {
    const name = newName.trim()
    if (!name) return
    const p = store.create(name)
    setNewName("")
    onOpen(p.id)
  }

  const lab = labById(labId)
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-nightjar-surface px-4 py-2">
        <button
          onClick={onBack}
          title="Back to the workspace"
          className="rounded px-2 py-1 text-xs text-nightjar-text/50 hover:bg-nightjar-surface hover:text-nightjar-text"
        >
          ‹ {lab.label}
        </button>
        <span className="font-medium text-nightjar-text">📁 Projects</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects…"
          className="ml-auto w-48 rounded-lg bg-nightjar-surface px-3 py-1 text-sm text-nightjar-text placeholder:text-nightjar-text/30 focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
        />
        <button
          onClick={() => setSort((s) => (s === "updated" ? "name" : "updated"))}
          title="Toggle sort"
          className="rounded border border-nightjar-surface px-2 py-1 text-xs text-nightjar-text/70 hover:bg-nightjar-surface"
        >
          Sort: {sort === "updated" ? "Last updated" : "Name"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-4 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitNew()}
            placeholder="New project name…"
            className="w-64 rounded-lg bg-nightjar-surface px-3 py-2 text-sm text-nightjar-text placeholder:text-nightjar-text/30 focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
          />
          <button
            onClick={submitNew}
            disabled={!newName.trim()}
            className="rounded-lg bg-nightjar-accent px-3 py-2 text-sm font-medium text-nightjar-base hover:brightness-110 disabled:opacity-40"
          >
            New project
          </button>
        </div>

        {visible.length === 0 ? (
          <div className="mt-16 text-center text-sm text-nightjar-text/30">
            {store.projects.length === 0
              ? "No projects yet — create one to keep related work together."
              : "No projects match your search."}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {visible.map((p) => (
              <ProjectCard key={p.id} project={p} store={store} onOpen={() => onOpen(p.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectCard({ project, store, onOpen }: { project: Project; store: ProjectsStore; onOpen: () => void }) {
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(project.name)
  // Escape cancels a rename, but unmounting the focused input can still fire onBlur → commit.
  // This flag makes that trailing commit a no-op so Escape genuinely discards the edit.
  const cancelRef = useRef(false)

  function commitRename() {
    if (cancelRef.current) {
      cancelRef.current = false
      setRenaming(false)
      return
    }
    store.rename(project.id, name)
    setRenaming(false)
  }

  return (
    <div className="relative flex flex-col gap-1 rounded-xl border border-nightjar-surface bg-nightjar-surface/30 p-3 hover:border-nightjar-accent/50">
      <div className="flex items-start gap-1">
        {renaming ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename()
              if (e.key === "Escape") {
                cancelRef.current = true // suppress the onBlur-on-unmount commit → Escape discards the edit
                setName(project.name)
                setRenaming(false)
              }
            }}
            onBlur={commitRename}
            className="flex-1 rounded bg-nightjar-base px-1 text-sm text-nightjar-text focus:outline-none"
          />
        ) : (
          <button
            onClick={onOpen}
            title={project.name}
            className="flex-1 truncate text-left text-sm font-medium text-nightjar-text hover:text-nightjar-accent"
          >
            {project.name}
          </button>
        )}
        <button
          onClick={() => store.toggleFavorite(project.id)}
          title={project.favorite ? "Unfavorite" : "Favorite"}
          className="text-nightjar-text/40 hover:text-nightjar-accent"
        >
          {project.favorite ? "★" : "☆"}
        </button>
        <button onClick={() => setMenu((v) => !v)} title="More" className="text-nightjar-text/40 hover:text-nightjar-text">
          ⋯
        </button>
      </div>
      {project.description && <p className="truncate text-xs text-nightjar-text/50">{project.description}</p>}
      <span className="text-[11px] text-nightjar-text/30">Updated {fmtWhen(project.updatedAt)}</span>

      {menu && (
        <div className="absolute right-2 top-8 z-10 flex flex-col rounded-lg border border-nightjar-surface bg-nightjar-base py-1 text-xs shadow-lg">
          <button
            onClick={() => {
              setName(project.name) // start the rename from the current name, not a stale edit
              setRenaming(true)
              setMenu(false)
            }}
            className="px-3 py-1 text-left text-nightjar-text/80 hover:bg-nightjar-surface"
          >
            Rename
          </button>
          <button
            onClick={() => {
              store.duplicate(project.id)
              setMenu(false)
            }}
            className="px-3 py-1 text-left text-nightjar-text/80 hover:bg-nightjar-surface"
          >
            Duplicate
          </button>
          <button
            onClick={() => {
              store.remove(project.id)
              setMenu(false)
            }}
            className="px-3 py-1 text-left text-nightjar-alert hover:bg-nightjar-surface"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
