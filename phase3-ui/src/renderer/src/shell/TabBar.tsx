// TabBar — the top-level tabs (redesign Stage 5). Replaces the old flat header
// ModeSelector row. Structural reference: Claude Desktop's Chat/Cowork/Code.
//
// COWORK IS DEFERRED TO v2 and must not ship active in v1 (JUNE_better.md). It is removed
// from the tab list — and unmounted in AppShell — rather than merely disabled: a disabled
// button still renders the screen behind it, so "disabled" would not actually keep the
// surface out of the build. Dropping it from TabId is deliberate; it turns any remaining
// reference into a typecheck error rather than dead runtime code.
//
// `CoworkScreen.tsx` is kept in the tree for v2 — nothing imports it.
//
// M-CADfold (Lab.md §2/§10): the standalone CAD tab is GONE — CAD now lives solely at
// LAB → Mechanical, whose shell (rail + canvas + inspector + Prompt-to-CAD composer) is a
// superset of the old CAD tab. As with Cowork, "cad" is dropped from TabId (not just hidden),
// so any remaining reference becomes a typecheck error rather than dead runtime code.
export type TabId = "chat" | "projects" | "lab" | "code"

const TABS: { id: TabId; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "projects", label: "Projects" },
  { id: "lab", label: "LAB" },
  { id: "code", label: "Code" },
]

export function TabBar({ tab, onChange }: { tab: TabId; onChange: (t: TabId) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-nightjar-surface/50 p-0.5">
      {TABS.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          aria-current={tab === t.id}
          className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
            tab === t.id ? "bg-nightjar-accent text-nightjar-base" : "text-nightjar-text/60 hover:text-nightjar-text"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
