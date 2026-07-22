// M3 — the ViewerManager seam (phase 1: match/extract).
//
// A ViewerDescriptor declares how a lab's agent output feeds its viewer. This is the plug-in point
// the discipline labs (M4 Physics, M6 Chem, M8 Bio) register into. This first phase extracts the
// MATCH/EXTRACT half — the pure predicate that turns a completed tool call into the viewer's raw
// input — into per-viewer descriptors that the EXISTING dispatch routes through, so behaviour is
// byte-identical.
//
// Deliberately NOT unified yet (rule of three + the two current viewers are structurally different):
//   • convert (CAD's async STEP→GLB vs Code's mirror-and-serve) and the dedup/latest-wins machinery
//     stay in their current contexts — CAD in SessionsContext, Code in ArtifactContext.
//   • the render side stays per-viewer: CAD mounts in the LabShell (canvas + inspector regions),
//     Code in a 45%-wide panel. A shared render host would be premature from only two examples with
//     divergent layouts; M4's Physics viewer gives the validating third before that lands.
// A new lab registers by adding a descriptor file here and routing its dispatch through `.match`.
import type { ToolCall } from "../opencode"

export interface ViewerDescriptor<Extracted> {
  readonly id: string
  // Predicate + extract in one: the viewer's raw input for this tool call, or null if not for it.
  readonly match: (call: ToolCall) => Extracted | null
}

export { cadViewer, isCadExportTool, cadExportPath, matchCadExport } from "./cadViewer"
export { codeViewer } from "./codeViewer"
