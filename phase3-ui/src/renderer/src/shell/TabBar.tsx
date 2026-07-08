// TabBar — the three top-level tabs (redesign Stage 5). Replaces the old flat
// header ModeSelector row. Structural reference: Claude Desktop's Chat/Cowork/Code.
export type TabId = "chat" | "cowork" | "code"

const TABS: { id: TabId; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "cowork", label: "Cowork" },
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
