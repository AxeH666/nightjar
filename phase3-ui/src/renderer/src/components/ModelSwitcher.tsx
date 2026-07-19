import type { ModelChoice } from "../lib/byok"

// Header control: pick the active model (global — applies to whatever mode is active; see the
// decision note in App.tsx). Local default + any configured cloud models. A quiet, persistent ☁
// glyph (in the silver secondary-chrome color, not the loud alert red) shows whenever ANY cloud
// target is active — the chat model and/or a capability set Online — so there is always a cloud
// indication even after the dismissible cloud banners are closed. The gear opens key management.
export function ModelSwitcher({
  choices,
  activeId,
  onSelect,
  onManageKeys,
  cloudActive,
}: {
  choices: ModelChoice[]
  activeId: string
  onSelect: (id: string) => void
  onManageKeys: () => void
  cloudActive: boolean
}) {
  const active = choices.find((c) => c.id === activeId)
  return (
    <div className="flex items-center gap-1">
      {cloudActive && (
        <span
          className="text-nightjar-silver"
          title="Cloud active — some data leaves your machine (the chat model and/or a capability is online)"
          aria-label="cloud active"
        >
          ☁
        </span>
      )}
      <select
        value={activeId}
        onChange={(e) => onSelect(e.target.value)}
        title={active?.local ? "Local model — runs on-device, offline" : "Cloud model — data leaves your machine"}
        className="rounded-md border border-nightjar-surface bg-nightjar-surface px-2 py-1 text-xs text-nightjar-text/80 focus:outline-none focus:ring-1 focus:ring-nightjar-accent"
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
