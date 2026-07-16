import { Inspector, type InspectorTab } from "./Inspector"
import type { CadScene } from "../../lib/useCadScene"

// The CAD lab's Inspector content (Lab.md §4.3), built on the shared tabbed Inspector:
//   • Structure — the parts tree + explode / isolate / per-part visibility / reset, moved
//     out of CadViewer's built-in sidebar (and finally wiring the previously-unused
//     setPartVisible controller hook to real checkboxes).
//   • Properties — part count + bounding-box extents read from the model.
//   • Downloads — an honest summary; a per-file save/reveal affordance needs main-process
//     wiring and lands with the ViewerManager artifact work (rule 8 — no fake button).
function fmtMm(v: number): string {
  return v >= 100 ? v.toFixed(0) : v.toFixed(1)
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded border border-nightjar-surface/60 px-2 py-1">
      <span className="text-nightjar-text/50">{label}</span>
      <span className="text-nightjar-text/80">{value}</span>
    </div>
  )
}

export function CadInspector({ scene }: { scene: CadScene }) {
  const { parts, explode, setExplode, isolated, setIsolated, setPartVisible, reset, bounds } = scene
  const hasModel = parts.length > 0

  const structure: InspectorTab = {
    id: "structure",
    label: "Structure",
    content: hasModel ? (
      <div className="flex flex-col gap-3">
        <div>
          <label className="mb-1 flex items-center justify-between text-nightjar-text/70">
            <span>Explode</span>
            <span className="text-nightjar-text/40">{explode.toFixed(1)}×</span>
          </label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={explode}
            onChange={(e) => setExplode(Number(e.target.value))}
            className="w-full accent-nightjar-accent"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-nightjar-text/70">Parts ({parts.length})</span>
          {parts.map((p) => (
            <div key={p.name} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={p.visible}
                onChange={(e) => setPartVisible(p.name, e.target.checked)}
                title="Toggle visibility"
                className="accent-nightjar-accent"
              />
              <button
                onClick={() => setIsolated(isolated === p.name ? null : p.name)}
                title={isolated === p.name ? "Show all parts" : "Show only this part"}
                className={`flex-1 truncate rounded px-2 py-1 text-left ${
                  isolated === p.name ? "bg-nightjar-accent text-nightjar-base" : "text-nightjar-text/80 hover:bg-nightjar-surface"
                }`}
              >
                {p.name}
              </button>
            </div>
          ))}
        </div>
        <button onClick={reset} className="rounded border border-nightjar-surface px-2 py-1 text-nightjar-text/70 hover:bg-nightjar-surface">
          Reset view
        </button>
        {isolated && (
          <p className="text-[11px] text-nightjar-text/40">
            Isolated: <b>{isolated}</b> — click it again or Reset to reassemble.
          </p>
        )}
      </div>
    ) : (
      <p className="text-nightjar-text/30">Build a model to see its part structure.</p>
    ),
  }

  const properties: InspectorTab = {
    id: "properties",
    label: "Properties",
    content: hasModel ? (
      <div className="flex flex-col gap-2">
        <Row label="Parts" value={String(parts.length)} />
        {bounds && <Row label="Bounding box" value={`${fmtMm(bounds[0])} × ${fmtMm(bounds[1])} × ${fmtMm(bounds[2])} mm`} />}
        <p className="mt-1 text-nightjar-text/30">
          Volume, mass, and surface area come from the CAD agent's measure tool — ask it to measure the part.
        </p>
      </div>
    ) : (
      <p className="text-nightjar-text/30">No model yet.</p>
    ),
  }

  const downloads: InspectorTab = {
    id: "downloads",
    label: "Downloads",
    content: (
      <div className="flex flex-col gap-2">
        <p className="text-nightjar-text/50">
          When the CAD agent runs its export tool it writes the model (STEP / STL / GLB) into the workspace.
        </p>
        <p className="text-nightjar-text/30">A per-file save / reveal button lands with the ViewerManager artifact work.</p>
      </div>
    ),
  }

  return <Inspector tabs={[structure, properties, downloads]} />
}
