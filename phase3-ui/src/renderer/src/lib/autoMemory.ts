// Auto-memory generation — PURE logic (AM-2b). No React, no engine: the summariser orchestration
// (SessionsContext.summarizeProjectChats) extracts chat text and injects the model call; everything
// here is deterministic and unit-tested. The propose→Accept/Discard flow (projectContent) is what
// actually protects the user's edits — a weak local model can't be trusted to preserve them — so this
// only prepares the input and interprets counts.

export interface MemoryTurn {
  role: "user" | "assistant"
  text: string
}
export interface ChatTranscript {
  title: string
  turns: MemoryTurn[]
}

// Concatenate a project's chats into ONE transcript for summarisation, in the order given (the caller
// passes newest-first), capped to maxChars so a long history fits the local model's context. When the
// cap is hit, later chats are dropped and an explicit marker is appended — so a summary is never
// silently based on partial coverage (rule 8). If even the FIRST chat overflows, a truncated head of
// it is included (never nothing — else the model would summarise from the directive alone). Chats with
// no text are skipped. Returns the text AND `includedChats` (how many made it in) so the caller can
// tell the user "based on N of M chats" whenever coverage is partial.
export function assembleTranscripts(chats: ChatTranscript[], maxChars: number): { text: string; includedChats: number } {
  const blocks: string[] = []
  let used = 0
  let truncated = false
  for (const chat of chats) {
    const lines = chat.turns.filter((t) => t.text.trim()).map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text.trim()}`)
    if (!lines.length) continue
    const block = `### ${chat.title.trim() || "Chat"}\n${lines.join("\n")}`
    const sep = blocks.length ? 2 : 0 // "\n\n" between blocks, not before the first
    if (used + block.length + sep > maxChars) {
      // Doesn't fit. If nothing is in yet, include a truncated HEAD so there's always material to
      // summarise (never directive-only — Bugbot); otherwise stop before this chat.
      if (blocks.length === 0) {
        const room = maxChars - 48 // leave space for the marker below
        if (room > 0) {
          blocks.push(block.slice(0, room))
          used += room
        }
      }
      truncated = true
      break
    }
    blocks.push(block)
    used += block.length + sep
  }
  const body = blocks.join("\n\n")
  const text = truncated && body ? `${body}\n\n[…older/longer chats omitted to fit the context window]` : body
  return { text, includedChats: blocks.length }
}

// The summarise directive + material. `currentMemory` (if any) is offered as the base to BUILD ON, so
// a regeneration extends rather than discards — but the propose→Accept/Discard flow, not this prompt,
// is what guarantees the user's edits survive. "Do not call any tools" pairs with the tools-denied
// summary agent as belt-and-suspenders.
export function buildSummaryPrompt(args: { transcripts: string; currentMemory: string }): string {
  const base = args.currentMemory.trim()
    ? `The project's CURRENT memory (build on it; keep anything still true, correct anything the chats contradict):\n${args.currentMemory.trim()}\n\n`
    : ""
  return (
    "Summarise the durable facts, preferences, decisions, and context about THIS PROJECT from the " +
    "conversations below — the kind of thing worth remembering across future chats. Write a concise " +
    "memory (a few short paragraphs or bullet points), not a play-by-play of the conversation. Do not " +
    "call any tools; reply with only the memory text.\n\n" +
    base +
    `Conversations:\n${args.transcripts}`
  )
}

// Is the accepted memory stale — have chats been added since it was generated? Count-based, so it's a
// crude hint (deleting + re-adding chats can net zero while content changed); good enough to surface a
// non-intrusive "regenerate?" nudge, never to auto-regenerate.
export function memoryStaleness(args: { generatedChatCount: number; currentChatCount: number }): { stale: boolean; newChats: number } {
  const newChats = Math.max(0, args.currentChatCount - args.generatedChatCount)
  return { stale: newChats > 0, newChats }
}
