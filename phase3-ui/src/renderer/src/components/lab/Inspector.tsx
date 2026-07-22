import { useState, type ReactNode } from "react"

// The shared LAB right-hand Inspector (Lab.md §4.3): one tabbed frame reused by every lab,
// its tab set + content supplied by the active viewer. Generalizes the former CAD viewer's control
// sidebar (and, later via the ViewerManager, ArtifactPanel's Preview/Code/Files tabs) into
// one Properties / Structure / Downloads shape. Pure presentation — no lab-specific logic.
export interface InspectorTab {
  id: string
  label: string
  content: ReactNode
}

export function Inspector({ tabs }: { tabs: InspectorTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id)
  const current = tabs.find((t) => t.id === active) ?? tabs[0]
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 border-b border-nightjar-surface">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={`flex-1 px-2 py-1.5 text-xs ${
              current?.id === t.id
                ? "border-b-2 border-nightjar-accent text-nightjar-accent"
                : "text-nightjar-text/50 hover:text-nightjar-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">{current?.content}</div>
    </div>
  )
}
