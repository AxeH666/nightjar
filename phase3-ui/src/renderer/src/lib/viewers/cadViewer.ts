import type { ToolCall } from "../opencode"
import type { ViewerDescriptor } from "./index"

// The CAD viewer's match/extract (M3). The CAD agent's build123d_export tool is the ONLY thing that
// fills the 3D viewer (render_view emits a PNG the user never sees). These predicates were previously
// inlined + DUPLICATED across three sites in SessionsContext — the export watcher, the sawExport
// auto-export check, and the demo-load "mark processed" scan — with the .step regex untested. Extracted
// here as one tested source; the sites now route through these functions (byte-identical).

// Is this the CAD export tool? (Namespaced as e.g. "cad-build123d_export"; matched loosely.)
export function isCadExportTool(tool: string): boolean {
  return /build123d_export/i.test(tool)
}

// export() prints "Exported to <path>.step<suffix>" (single) OR "Exported to:\n<path>.step\n…"
// (multi/list). Match both: optional colon, any whitespace (incl. the newline), then the FIRST token
// ending in .step — stopping before the trailing volume/bbox suffix. Returns the path, or null.
export function cadExportPath(output: string | null | undefined): string | null {
  return /Exported to:?\s*(\S[^\n]*?\.step)\b/i.exec(output ?? "")?.[1] ?? null
}

// The descriptor match/extract: a COMPLETED export tool call whose output names a .step → that path.
export function matchCadExport(call: ToolCall): string | null {
  if (!isCadExportTool(call.tool) || call.status !== "completed") return null
  return cadExportPath(call.output)
}

// Extracted = the STEP file path; SessionsContext's watcher converts it (STEP→GLB) into the 3D model.
export const cadViewer: ViewerDescriptor<string> = { id: "cad", match: matchCadExport }
