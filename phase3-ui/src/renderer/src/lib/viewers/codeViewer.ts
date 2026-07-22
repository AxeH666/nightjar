import { artifactActionFromTool, type ArtifactAction } from "../preview"
import type { ViewerDescriptor } from "./index"

// The Code viewer's descriptor (M3). Its match/extract already lives — pure — in lib/preview
// (`artifactActionFromTool`: a write/edit tool call → the file mirror action, or null). This just
// registers it as the Code viewer so both handoffs are defined through the same ViewerDescriptor
// shape; ArtifactContext dispatches through `codeViewer.match` (byte-identical to before).
export const codeViewer: ViewerDescriptor<ArtifactAction> = { id: "code", match: artifactActionFromTool }
