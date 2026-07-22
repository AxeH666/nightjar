import { describe, expect, it } from "vitest"
import { assembleTranscripts, buildSummaryPrompt, memoryStaleness, type ChatTranscript } from "./autoMemory"

describe("assembleTranscripts", () => {
  const chat = (title: string, ...turns: Array<[("user" | "assistant"), string]>): ChatTranscript => ({
    title,
    turns: turns.map(([role, text]) => ({ role, text })),
  })

  it("labels roles, headers each chat by title, joins in order, and counts included chats", () => {
    const out = assembleTranscripts([chat("Setup", ["user", "use Rust"], ["assistant", "ok"]), chat("Bugs", ["user", "fix it"])], 10000)
    expect(out.text).toBe("### Setup\nUser: use Rust\nAssistant: ok\n\n### Bugs\nUser: fix it")
    expect(out.includedChats).toBe(2)
    expect(out.truncated).toBe(false) // everything fit
  })

  it("skips empty/whitespace turns and chats with no text", () => {
    const out = assembleTranscripts([chat("A", ["user", "  "], ["assistant", "kept"]), chat("Empty", ["user", ""])], 10000)
    expect(out.text).toBe("### A\nAssistant: kept") // the whitespace user turn and the all-empty chat are dropped
    expect(out.includedChats).toBe(1)
  })

  it("falls back to 'Chat' for an untitled chat", () => {
    expect(assembleTranscripts([chat("   ", ["user", "hi"])], 10000).text).toBe("### Chat\nUser: hi")
  })

  it("drops later chats past the cap, appends a marker, and reports fewer includedChats", () => {
    const first = assembleTranscripts([chat("Keep", ["user", "hi"])], 10000)
    const out = assembleTranscripts([chat("Keep", ["user", "hi"]), chat("Drop", ["user", "x".repeat(500)])], first.text.length + 5)
    expect(out.text).toBe("### Keep\nUser: hi\n\n[…older/longer chats omitted to fit the context window]")
    expect(out.includedChats).toBe(1) // only the first chat made it — the caller can flag "1 of 2"
    expect(out.truncated).toBe(true)
  })

  it("truncated is true even when the SINGLE chat is shortened to fit (all chats 'included' — Bugbot)", () => {
    const out = assembleTranscripts([chat("Big", ["user", "y".repeat(1000)])], 200)
    expect(out.text.length).toBeGreaterThan(0) // NOT empty — a truncated HEAD is included
    expect(out.text.startsWith("### Big\nUser: yyy")).toBe(true)
    expect(out.text).toContain("omitted to fit the context window")
    expect(out.includedChats).toBe(1)
    expect(out.truncated).toBe(true) // includedChats == chatCount, yet coverage is still partial
  })

  it("returns '' with includedChats 0 and truncated false when there's nothing to include", () => {
    expect(assembleTranscripts([], 100)).toEqual({ text: "", includedChats: 0, truncated: false })
    expect(assembleTranscripts([chat("Empty", ["user", ""])], 100)).toEqual({ text: "", includedChats: 0, truncated: false })
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
