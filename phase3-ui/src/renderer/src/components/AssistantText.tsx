import { parseArtifactSegments } from "../lib/artifacts"
import { fmtSize } from "../lib/preview"
import { useArtifact } from "../context/ArtifactContext"

// Renders an assistant text block, turning any generated file artifacts (renderable fenced
// code blocks — html/svg/markdown, or a full HTML doc) into canvas cards (Open in the preview
// panel / Download) instead of dumping the raw file source into the chat. Plain prose renders
// exactly as before (parseArtifactSegments returns the whole text as one segment).
export function AssistantText({ text, sessionID }: { text: string; sessionID: string }) {
  const { openArtifactFromContent, downloadArtifactContent } = useArtifact()
  return (
    <>
      {parseArtifactSegments(text).map((seg, i) =>
        seg.type === "text" ? (
          seg.text.trim() ? (
            <p key={i} className="whitespace-pre-wrap leading-relaxed">
              {seg.text}
            </p>
          ) : null
        ) : (
          <div
            key={i}
            className="my-2 flex items-center gap-2 rounded-lg border border-nightjar-surface bg-nightjar-surface/40 px-3 py-2"
          >
            <span aria-hidden className="text-lg">
              📄
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-nightjar-text">{seg.name}</div>
              <div className="text-xs uppercase tracking-wide text-nightjar-text/40">
                {seg.ext} · {fmtSize(seg.content.length)}
              </div>
            </div>
            <button
              onClick={() => openArtifactFromContent(sessionID, seg.name, seg.content)}
              className="rounded border border-nightjar-accent px-2 py-0.5 text-xs text-nightjar-accent hover:bg-nightjar-accent/10"
            >
              Open
            </button>
            <button
              onClick={() => downloadArtifactContent(sessionID, seg.name, seg.content)}
              className="rounded border border-nightjar-surface px-2 py-0.5 text-xs text-nightjar-text/70 hover:bg-nightjar-surface"
            >
              Download
            </button>
          </div>
        ),
      )}
    </>
  )
}
