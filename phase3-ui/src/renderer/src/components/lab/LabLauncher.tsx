import { LABS, type LabId } from "./labs"

// The LAB launcher (Lab.md §3): a deliberately sparse screen of large discipline cards —
// a title, the cards with their emoji, and the "walk into a building, pick a lab" metaphor.
// No workspace chrome appears until a lab is chosen. Picking a card enters that lab's shared
// shell (§4). "Soon" cards still enter (into a coming-soon shell) so the card is never a
// dead control (CLAUDE.md rule 8).
export function LabLauncher({ onEnter }: { onEnter: (id: LabId) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-nightjar-text">Choose a laboratory</h1>
        <p className="mt-1 text-sm text-nightjar-text/50">
          Think of it as entering a building and choosing which laboratory to work in.
        </p>
      </div>
      <div className="flex flex-wrap items-stretch justify-center gap-4">
        {LABS.map((lab) => {
          const soon = lab.status === "soon"
          return (
            <button
              key={lab.id}
              onClick={() => onEnter(lab.id)}
              className={`group relative flex w-64 flex-col gap-2 rounded-xl border p-5 text-left transition-colors ${
                soon
                  ? "border-nightjar-surface bg-nightjar-surface/20 hover:bg-nightjar-surface/40"
                  : "border-nightjar-accent/40 bg-nightjar-surface/40 hover:border-nightjar-accent hover:bg-nightjar-surface/70"
              }`}
            >
              <span className="text-3xl" aria-hidden>{lab.emoji}</span>
              <span className="font-medium text-nightjar-text">{lab.label}</span>
              <span className="text-xs text-nightjar-text/50">{lab.blurb}</span>
              {soon && (
                <span className="absolute right-3 top-3 rounded-full bg-nightjar-surface px-2 py-0.5 text-[10px] uppercase tracking-wide text-nightjar-text/50">
                  soon
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
