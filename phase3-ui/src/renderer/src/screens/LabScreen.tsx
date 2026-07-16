import { useState } from "react"
import { LabLauncher } from "../components/lab/LabLauncher"
import { MechanicalLab } from "../components/lab/MechanicalLab"
import { LabShell } from "../shell/LabShell"
import { LabRail } from "../components/lab/LabRail"
import { labById, type LabId, type LabDef } from "../components/lab/labs"

// The LAB tab (Lab.md §3–§4): shows the launcher until a lab is entered, then that lab's
// shared workspace shell. Only Mechanical is wired live in this PR — it reuses the existing
// CAD stack (see MechanicalLab). Bio/Chem enter a coming-soon shell so their launcher cards
// are honest placeholders, not dead buttons (CLAUDE.md rule 8). `entered` is kept here (the
// screen is CSS-hidden, never unmounted, on tab switch) so the chosen lab survives tab
// changes. Settings is threaded from AppShell so the rail opens the existing settings modal.
export function LabScreen({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [entered, setEntered] = useState<LabId | null>(null)

  if (!entered) return <LabLauncher onEnter={setEntered} />

  const back = () => setEntered(null)
  if (entered === "mechanical") return <MechanicalLab onBack={back} onOpenSettings={onOpenSettings} />
  return <ComingSoonLab lab={labById(entered)} onBack={back} onOpenSettings={onOpenSettings} />
}

// A not-yet-built lab rendered in the real shell chrome, with an honest placeholder center
// and a disabled prompt — so a future lab is a visible, non-functional workspace rather
// than a dead card (CLAUDE.md rule 8). Bio and Chem use this until their MCPs/viewers land.
function ComingSoonLab({ lab, onBack, onOpenSettings }: { lab: LabDef; onBack: () => void; onOpenSettings: () => void }) {
  return (
    <LabShell
      rail={<LabRail lab={lab} onBack={onBack} onOpenSettings={onOpenSettings} />}
      center={
        <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
          <span className="text-4xl" aria-hidden>{lab.emoji}</span>
          <div className="text-lg font-medium text-nightjar-text">{lab.label}</div>
          <p className="max-w-sm text-sm text-nightjar-text/40">
            {lab.blurb} This lab isn't wired up yet — it lands in a later step of the LAB build.
          </p>
        </div>
      }
      inspector={<div className="p-3 text-xs text-nightjar-text/30">Inspector appears once this lab is live.</div>}
      bottom={
        <div className="flex h-full items-center px-4 text-sm text-nightjar-text/30">
          The prompt turns on when {lab.label} is built.
        </div>
      }
    />
  )
}
