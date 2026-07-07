// Renderer-side live-preview / Artifacts helpers. Talks to the main process over the
// preload bridge (window.nightjar.preview.*). The coding agent's write/edit tool
// calls carry the file content in their `input`; we mirror that into a per-session
// sandbox served by the loopback static server and render it in the ArtifactPanel.
import type { ToolCall } from "./opencode"

export interface PreviewEntry {
  path: string
  size: number
}

interface PreviewBridge {
  write(sessionID: string, filePath: string, content: string): Promise<{ url: string; nonce: number; rel: string }>
  edit(sessionID: string, filePath: string, oldString: string, newString: string, replaceAll: boolean): Promise<{ url: string; nonce: number; rel: string }>
  url(sessionID: string, entry?: string): Promise<string>
  list(sessionID: string): Promise<PreviewEntry[]>
  read(sessionID: string, relPath: string): Promise<{ mime: string; dataUrl: string }>
  saveAs(sessionID: string, relPath: string): Promise<boolean>
  reveal(sessionID: string, relPath?: string): Promise<void>
}

export function previewBridge(): PreviewBridge | null {
  return (window as unknown as { nightjar?: { preview?: PreviewBridge } }).nightjar?.preview ?? null
}

// A write/edit tool-call → the mirror action to perform, or null if it isn't a
// file-writing tool (or lacks a filePath). Read straight from the opaque `input`.
export type ArtifactAction =
  | { kind: "write"; filePath: string; content: string }
  | { kind: "edit"; filePath: string; oldString: string; newString: string; replaceAll: boolean }

export function artifactActionFromTool(call: ToolCall): ArtifactAction | null {
  const t = (call.tool || "").toLowerCase()
  const input = (call.input ?? {}) as Record<string, unknown>
  const filePath = typeof input.filePath === "string" ? input.filePath : ""
  if (!filePath) return null
  if (t === "write" && typeof input.content === "string") {
    return { kind: "write", filePath, content: input.content }
  }
  if (t === "edit" && typeof input.oldString === "string" && typeof input.newString === "string") {
    return { kind: "edit", filePath, oldString: input.oldString, newString: input.newString, replaceAll: !!input.replaceAll }
  }
  return null
}

// Is this relative path something the Preview tab can render? (html/svg/markdown —
// markdown is rendered → HTML server-side.)
export function isRenderable(rel: string): boolean {
  return /\.(html?|svg|md)$/i.test(rel)
}

// Prefer the "primary" artifact to show: the latest .html, else the latest renderable,
// else the latest file. `prev` biases toward keeping the current selection stable.
export function pickActiveEntry(entries: string[], prev: string): string {
  if (prev && entries.includes(prev)) return prev
  const html = entries.filter((e) => /\.html?$/i.test(e))
  if (html.length) return html[html.length - 1]
  const renderable = entries.filter(isRenderable)
  if (renderable.length) return renderable[renderable.length - 1]
  return entries[entries.length - 1] ?? ""
}

export const fmtSize = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`
