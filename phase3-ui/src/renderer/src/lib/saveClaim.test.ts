import { describe, test, expect } from "vitest"
import { claimsFileButNoneWritten } from "./saveClaim"
import type { UiMessage } from "../components/ChatSurface"
import type { ToolCall } from "./opencode"

const text = (t: string): UiMessage => ({ id: "m1", role: "assistant", blocks: [{ kind: "text", text: t }] })
const withTool = (t: string, tool: string, status: ToolCall["status"]): UiMessage => ({
  id: "m1",
  role: "assistant",
  blocks: [
    { kind: "text", text: t },
    { kind: "tool", call: { callID: "c1", tool, status, input: {} } as unknown as ToolCall },
  ],
})
const bigHtml = `<!doctype html>\n<html><body>${"<p>x</p>".repeat(10)}</body></html>`

describe("claimsFileButNoneWritten (false-success guardrail)", () => {
  test("claim + no write + no artifact → warn (the reported sunset.html case)", () => {
    expect(claimsFileButNoneWritten(text("I've saved the HTML page for you as sunset.html in the workspace folder."))).toBe(true)
  })

  test("claim but a previewable artifact was produced → NO warn (canvas-from-message handled it)", () => {
    expect(claimsFileButNoneWritten(text(`Here's your page, saved as sunset.html:\n\n\`\`\`html\n${bigHtml}\n\`\`\``))).toBe(false)
  })

  test("claim + a COMPLETED write tool → NO warn (it really wrote the file)", () => {
    expect(claimsFileButNoneWritten(withTool("Saved styles.css for you.", "write", "completed"))).toBe(false)
  })

  test("claim + an ERRORED/truncated write that claimed success → warn", () => {
    expect(claimsFileButNoneWritten(withTool("I've written index.js for you.", "write", "error"))).toBe(true)
  })

  test("plain reply with no file claim → no warn", () => {
    expect(claimsFileButNoneWritten(text("Sure — here's how you'd approach it in general terms."))).toBe(false)
  })

  test("a save verb with NO filename → no warn (false-positive guard)", () => {
    expect(claimsFileButNoneWritten(text("I saved you some time by summarizing the key points below."))).toBe(false)
  })
})
