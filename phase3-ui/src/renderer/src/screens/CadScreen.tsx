// CadScreen — the Prompt-to-CAD tab (Task 5). Left: a composer bound to the `cad` session
// (the CAD agent drives build123d via MCP). Right: the 3D viewer, which updates whenever the
// agent's export completes → SessionsContext converts the STEP to a GLB → cadModel here.
//
// Lives in the tab slot the (v2-deferred) Cowork tab vacated: Chat / CAD / Code.
import { useSessions } from "../context/SessionsContext"
import { usePermission } from "../context/PermissionContext"
import { ChatSurface } from "../components/ChatSurface"
import { CadViewer } from "../components/CadViewer"

export function CadScreen() {
  const { slots, messagesOf, busyOf, send, createImage, cadModel, cadBusy, cadError } = useSessions()
  const { abortSession } = usePermission()
  const id = slots.cad

  return (
    <div className="flex h-full min-h-0">
      {/* Composer side */}
      <div className="flex min-h-0 w-[42%] min-w-[320px] flex-col border-r border-nightjar-surface">
        <ChatSurface
          messages={messagesOf(id)}
          busy={busyOf(id)}
          // CAD is a conversation with the cad agent — no research/web-search/create-image tools.
          onSend={(text, { attachments }) => send(id, text, { agent: "cad", attachments })}
          onCreateImage={(prompt) => createImage(id, prompt)}
          onStop={() => abortSession(id)}
          menu={{ research: false, webSearch: false, createImage: false }}
          emptyHint="Describe a part or assembly — June builds it in 3D."
          placeholder="Describe a part to build…  (e.g. “a bracket with two M4 holes”)"
          assistantLabel="cad"
        />
      </div>

      {/* Viewer side */}
      <div className="relative min-h-0 flex-1">
        <CadViewer glb={cadModel?.glb ?? null} busy={cadBusy} />
        {cadError && (
          <div className="absolute inset-x-0 bottom-0 m-3 rounded-lg border border-nightjar-alert/40 bg-nightjar-alert/10 px-3 py-2 text-xs text-nightjar-text/80">
            Couldn't build the model: {cadError}
          </div>
        )}
      </div>
    </div>
  )
}
