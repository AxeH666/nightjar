import { useSessions } from "../../context/SessionsContext"
import { usePermission } from "../../context/PermissionContext"
import { useConnection } from "../../context/ConnectionContext"
import { ChatSurface } from "../ChatSurface"
import { CadViewer } from "../CadViewer"
import { LabShell } from "../../shell/LabShell"
import { LabRail } from "./LabRail"
import { labById } from "./labs"

// Mechanical & Physics inside the LAB shell (Lab.md §5). It REUSES the existing CAD stack
// wholesale — the `cad` session slot, the `cad` agent, the STEP→GLB pipeline, and the
// CadViewer — so it introduces no new agent, MCP, permission gate, or session slot. The
// standalone CAD tab stays until the shell is proven (§2/§10). A dedicated Mechanical
// session slot arrives when Projects key sessions by (slot, projectId) in a later PR;
// until then this and the CAD tab share the one `cad` session, which is fine (same agent).
//
// CadViewer keeps its own explode/isolate/reset controls here; those fold into the unified
// right Inspector in the next-but-one PR, at which point this inspector panel fills out.
export function MechanicalLab({ onBack, onOpenSettings }: { onBack: () => void; onOpenSettings: () => void }) {
  const { slots, messagesOf, busyOf, send, createImage, cadModel, cadBusy, cadError, loadCadHero, sessionIdsBySlot } = useSessions()
  const { abortSession } = usePermission()
  const { connected } = useConnection()
  const id = slots.cad

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
      center={<CadViewer glb={cadModel?.glb ?? null} busy={cadBusy} />}
      inspector={
        <div className="flex h-full flex-col gap-2 p-3 text-xs">
          <div className="text-xs uppercase tracking-wide text-nightjar-text/40">Inspector</div>
          <div className="rounded border border-nightjar-surface/60 p-2 text-nightjar-text/60">
            <div className="flex justify-between">
              <span>Parts</span>
              <span>{cadModel?.parts.length ?? 0}</span>
            </div>
          </div>
          <p className="text-nightjar-text/30">
            Properties · Structure · Downloads land in the unified Inspector next.
          </p>
        </div>
      }
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
