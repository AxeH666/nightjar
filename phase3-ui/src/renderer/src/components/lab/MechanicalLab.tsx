import { useSessions } from "../../context/SessionsContext"
import { usePermission } from "../../context/PermissionContext"
import { useConnection } from "../../context/ConnectionContext"
import { useCadScene } from "../../lib/useCadScene"
import { ChatSurface } from "../ChatSurface"
import { CadCanvas } from "./CadCanvas"
import { CadInspector } from "./CadInspector"
import { LabShell } from "../../shell/LabShell"
import { LabRail } from "./LabRail"
import { labById } from "./labs"

// Mechanical & Physics inside the LAB shell (Lab.md §5). REUSES the existing CAD stack — the
// `cad` session slot, the `cad` agent, and the STEP→GLB pipeline — so it adds no new agent,
// MCP, permission gate, or session slot. One useCadScene controller drives BOTH the center
// canvas AND the right Inspector's explode/isolate/visibility controls, as separate shell
// regions. The standalone CAD tab (its own CadViewer) is untouched until it folds in (§2/§10).
export function MechanicalLab({ onBack, onOpenSettings }: { onBack: () => void; onOpenSettings: () => void }) {
  const { slots, messagesOf, busyOf, send, createImage, cadModel, cadBusy, cadError, loadCadHero, sessionIdsBySlot } = useSessions()
  const { abortSession } = usePermission()
  const { connected } = useConnection()
  const id = slots.cad
  const scene = useCadScene(cadModel?.glb ?? null)

  return (
    <LabShell
      rail={
        <LabRail
          lab={labById("mechanical")}
          history={{ slot: "cad", agent: "cad", sessionIds: sessionIdsBySlot.cad, activeId: id }}
          onBack={onBack}
          onOpenSettings={onOpenSettings}
        />
      }
      center={<CadCanvas canvasRef={scene.canvasRef} busy={cadBusy} error={scene.error} hasModel={scene.parts.length > 0} />}
      inspector={<CadInspector scene={scene} />}
      bottom={
        <>
          <div className="flex items-center gap-2 border-b border-nightjar-surface px-3 py-1.5 text-xs">
            <span className="text-nightjar-text/50">Prompt-to-CAD</span>
            <button
              onClick={loadCadHero}
              disabled={cadBusy}
              title="Load the pre-authored planetary-gearset demo"
              className="ml-auto rounded border border-nightjar-surface px-2 py-0.5 text-nightjar-text/70 hover:bg-nightjar-surface disabled:opacity-40"
            >
              ⚙ Load demo
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <ChatSurface
              messages={messagesOf(id)}
              busy={busyOf(id)}
              blockedReason={connected && id ? null : "Connecting to the engine…"}
              // Mechanical talks to the cad agent — no research/web-search/create-image tools.
              onSend={(text, { attachments }) => send(id, text, { agent: "cad", attachments })}
              onCreateImage={(prompt) => createImage(id, prompt)}
              onStop={() => abortSession(id)}
              menu={{ research: false, webSearch: false, createImage: false }}
              emptyHint="Describe a part or assembly — June builds it in 3D."
              placeholder="Describe a part to build…  (e.g. “a bracket with two M4 holes”)"
              assistantLabel="cad"
            />
          </div>
          {cadError && (
            <div className="border-t border-nightjar-alert/40 bg-nightjar-alert/10 px-3 py-2 text-xs text-nightjar-text/80">
              Couldn't build the model: {cadError}
            </div>
          )}
        </>
      }
    />
  )
}
