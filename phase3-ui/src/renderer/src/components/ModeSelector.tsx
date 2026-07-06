import type { AgentInfo } from "../lib/opencode"

// Explicit mode selection (the source of truth per §8). Shows the active agent;
// the user switches directly. Never auto-switches.
export function ModeSelector({
  agents,
  active,
  onChange,
}: {
  agents: AgentInfo[]
  active: string
  onChange: (name: string) => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-nightjar-surface p-1">
      {agents.map((a) => {
        const on = a.name === active
        return (
          <button
            key={a.name}
            onClick={() => onChange(a.name)}
            title={a.description || a.name}
            className={
              "rounded-md px-3 py-1 text-sm capitalize transition-colors " +
              (on
                ? "bg-nightjar-accent text-nightjar-base font-medium"
                : "text-nightjar-text/70 hover:text-nightjar-text hover:bg-nightjar-text/5")
            }
          >
            {a.name}
          </button>
        )
      })}
    </div>
  )
}
