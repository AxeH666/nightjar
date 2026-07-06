import type { ModelChoice } from "../lib/byok"

// Header control: pick the active model (global — applies to whatever mode is
// active; see the decision note in App.tsx). Local default + any configured
// cloud models. A cloud choice is marked with ☁; the gear opens key management.
export function ModelSwitcher({
  choices,
  activeId,
  onSelect,
  onManageKeys,
}: {
  choices: ModelChoice[]
  activeId: string
  onSelect: (id: string) => void
  onManageKeys: () => void
}) {
  const active = choices.find((c) => c.id === activeId)
  return (
    <div className="flex items-center gap-1">
      <select
        value={activeId}
        onChange={(e) => onSelect(e.target.value)}
        title={active?.local ? "Local model — runs on-device, offline" : "Cloud model — data leaves your machine"}
        className={`rounded-md border bg-nightjar-surface px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-nightjar-accent ${
          active && !active.local
            ? "border-nightjar-alert text-nightjar-alert"
            : "border-nightjar-surface text-nightjar-text/80"
        }`}
      >
        {choices.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <button
        onClick={onManageKeys}
        title="Manage cloud API keys (BYOK)"
        className="rounded-md border border-nightjar-surface px-2 py-1 text-xs text-nightjar-text/60 hover:bg-nightjar-surface"
      >
        ⚙ keys
      </button>
    </div>
  )
}
