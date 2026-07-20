// Honesty guardrail (false-success). Detects the specific failure the user hit: the assistant
// CLAIMS it saved a file ("I've saved the HTML page for you as sunset.html") when nothing was
// written — a hallucinated write tool can leave no error card, so the claim is all the user sees.
// Pure + unit-tested; the turn-end reducer appends a correction when this returns true.
import { hasArtifact } from "./artifacts"
import type { UiMessage, UiBlock } from "../components/ChatSurface"

// A save VERB followed (within ~80 chars, same clause) by a real filename.ext. Requiring an
// actual file name — not just a bare "saved" — keeps false positives low.
const SAVE_CLAIM_RE =
  /\b(saved|wrote|written|created|generated)\b[^\n.!?]{0,80}?\b[\w-]+\.(html?|css|jsx?|tsx?|json|md|markdown|txt|svg|xml|ya?ml|csv|py|sh|pdf)\b/i

const msgText = (m: UiMessage): string =>
  m.blocks
    .filter((b): b is Extract<UiBlock, { kind: "text" }> => b.kind === "text")
    .map((b) => b.text)
    .join("\n")

const msgWroteAFile = (m: UiMessage): boolean =>
  m.blocks.some((b) => b.kind === "tool" && /^(write|edit)$/i.test(b.call.tool) && b.call.status === "completed")

// True when the assistant claimed a file save but this turn produced NEITHER a completed
// write/edit tool NOR a previewable artifact (canvas-from-message) — i.e. the claim is false.
export function claimsFileButNoneWritten(m: UiMessage): boolean {
  const text = msgText(m)
  return SAVE_CLAIM_RE.test(text) && !msgWroteAFile(m) && !hasArtifact(text)
}
