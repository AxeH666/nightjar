import { describe, expect, it } from "vitest"
import { assembleTranscripts, buildSummaryPrompt, memoryStaleness, type ChatTranscript } from "./autoMemory"

describe("assembleTranscripts", () => {
  const chat = (title: string, ...turns: Array<[("user" | "assistant"), string]>): ChatTranscript => ({
    title,
    turns: turns.map(([role, text]) => ({ role, text })),
  })

  it("labels roles, headers each chat by title, and joins in the given order", () => {
    const out = assembleTranscripts([chat("Setup", ["user", "use Rust"], ["assistant", "ok"]), chat("Bugs", ["user", "fix it"])], 10000)
    expect(out).toBe("### Setup\nUser: use Rust\nAssistant: ok\n\n### Bugs\nUser: fix it")
  })

  it("skips empty/whitespace turns and chats with no text", () => {
    const out = assembleTranscripts([chat("A", ["user", "  "], ["assistant", "kept"]), chat("Empty", ["user", ""])], 10000)
    expect(out).toBe("### A\nAssistant: kept") // the whitespace user turn and the all-empty chat are dropped
  })

  it("falls back to 'Chat' for an untitled chat", () => {
    expect(assembleTranscripts([chat("   ", ["user", "hi"])], 10000)).toBe("### Chat\nUser: hi")
  })

  it("drops later chats past the cap and appends an explicit truncation marker (never silent)", () => {
    const first = assembleTranscripts([chat("Keep", ["user", "hi"])], 10000)
    const out = assembleTranscripts([chat("Keep", ["user", "hi"]), chat("Drop", ["user", "x".repeat(500)])], first.length + 5)
    expect(out).toBe("### Keep\nUser: hi\n\n[…older chats omitted to fit the context window]")
  })

  it("returns '' (no marker) when there's nothing to include", () => {
    expect(assembleTranscripts([], 100)).toBe("")
    expect(assembleTranscripts([chat("Empty", ["user", ""])], 100)).toBe("")
  })
})

describe("buildSummaryPrompt", () => {
  it("includes the current memory as a base to build on when present", () => {
    const p = buildSummaryPrompt({ transcripts: "### A\nUser: hi", currentMemory: "Uses pnpm." })
    expect(p).toContain("CURRENT memory")
    expect(p).toContain("Uses pnpm.")
    expect(p).toContain("### A\nUser: hi")
    expect(p).toContain("Do not call any tools")
  })

  it("omits the base section entirely when there's no current memory", () => {
    const p = buildSummaryPrompt({ transcripts: "### A\nUser: hi", currentMemory: "   " })
    expect(p).not.toContain("CURRENT memory")
    expect(p).toContain("Conversations:\n### A\nUser: hi")
  })
})

describe("memoryStaleness", () => {
  it("is stale with a positive newChats count only when chats were ADDED since generation", () => {
    expect(memoryStaleness({ generatedChatCount: 2, currentChatCount: 5 })).toEqual({ stale: true, newChats: 3 })
    expect(memoryStaleness({ generatedChatCount: 5, currentChatCount: 5 })).toEqual({ stale: false, newChats: 0 })
    // Fewer chats now (some deleted) → not stale, and newChats never goes negative.
    expect(memoryStaleness({ generatedChatCount: 5, currentChatCount: 2 })).toEqual({ stale: false, newChats: 0 })
  })
})
