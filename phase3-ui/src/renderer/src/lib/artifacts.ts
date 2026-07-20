// "Canvas from message" (Task: Chat file-gen). The Chat assistant has no filesystem
// write tool by design, so when it generates a file it emits the content as a fenced
// code block in its reply. We detect renderable file artifacts in that text and surface
// them as canvas cards (preview + download) — reusing the existing preview sandbox +
// ArtifactPanel — WITHOUT giving the assistant any write capability. Pure + unit-tested.

// Fenced-block language → file extension, for the languages the preview iframe can render
// (mirrors lib/preview.ts isRenderable: html / svg / markdown).
const LANG_EXT: Record<string, string> = {
  html: "html",
  htm: "html",
  svg: "svg",
  markdown: "md",
  md: "md",
}

// Skip incidental tiny snippets (a `<div>x</div>` inside an explanation) — only real
// generated files become cards.
export const MIN_ARTIFACT_CHARS = 60

export type ArtifactSegment =
  | { type: "text"; text: string }
  | { type: "artifact"; ext: string; lang: string; content: string; name: string }

// A fenced block's (lang, content) → the renderable extension, or null if it isn't a
// previewable artifact. An unlabeled/other block that is clearly a full HTML document is
// treated as html so `make me a web page` (often emitted without a language tag) still cards.
function renderableExt(lang: string, content: string): string | null {
  const l = lang.trim().toLowerCase()
  if (LANG_EXT[l]) return LANG_EXT[l]
  if (/^\s*(<!doctype html|<html[\s>])/i.test(content)) return "html"
  return null
}

function defaultArtifactName(ext: string, idx: number): string {
  const base = ext === "html" ? "page" : ext === "svg" ? "image" : "document"
  return idx > 1 ? `${base}-${idx}.${ext}` : `${base}.${ext}`
}

// Split assistant text into ordered text/artifact segments. ONLY closed fenced blocks
// (```lang\n…\n```) that are renderable (html/svg/md, or full-HTML) and non-trivial become
// artifacts; everything else — prose, other/short code blocks, and an UNCLOSED fence that
// is still streaming — stays as text (so a half-written file never cards mid-stream). No
// fenced artifact → a single text segment identical to the input (unchanged rendering).
export function parseArtifactSegments(text: string): ArtifactSegment[] {
  const fence = /```([^\n`]*)\n([\s\S]*?)\n?```/g
  const segments: ArtifactSegment[] = []
  const counts: Record<string, number> = {}
  let last = 0
  let found = 0
  let m: RegExpExecArray | null
  while ((m = fence.exec(text)) !== null) {
    const [whole, langRaw, content] = m
    const ext = renderableExt(langRaw ?? "", content ?? "")
    if (!ext || (content ?? "").trim().length < MIN_ARTIFACT_CHARS) continue // leave non-artifact fences in the text
    if (m.index > last) segments.push({ type: "text", text: text.slice(last, m.index) })
    counts[ext] = (counts[ext] ?? 0) + 1
    segments.push({
      type: "artifact",
      ext,
      lang: (langRaw || ext).trim().toLowerCase(),
      content,
      name: defaultArtifactName(ext, counts[ext]),
    })
    last = m.index + whole.length
    found++
  }
  if (found === 0) return [{ type: "text", text }]
  if (last < text.length) segments.push({ type: "text", text: text.slice(last) })
  return segments
}

// Does this assistant text contain at least one previewable artifact? (Turn-end guardrail
// and card gating use this without rebuilding all segments.)
export function hasArtifact(text: string): boolean {
  return parseArtifactSegments(text).some((s) => s.type === "artifact")
}
