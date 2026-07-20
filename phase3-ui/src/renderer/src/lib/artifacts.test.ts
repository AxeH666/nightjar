import { describe, test, expect } from "vitest"
import { parseArtifactSegments, hasArtifact, MIN_ARTIFACT_CHARS } from "./artifacts"

const bigHtml = `<!doctype html>\n<html><head><title>Sunset</title></head><body>${"<p>x</p>".repeat(10)}</body></html>`

describe("parseArtifactSegments (canvas from message)", () => {
  test("plain prose with no fence → one unchanged text segment", () => {
    const segs = parseArtifactSegments("just a normal reply, nothing to render")
    expect(segs).toEqual([{ type: "text", text: "just a normal reply, nothing to render" }])
    expect(hasArtifact("just a normal reply")).toBe(false)
  })

  test("a fenced html block becomes an artifact between its surrounding text", () => {
    const text = `Here is your page:\n\n\`\`\`html\n${bigHtml}\n\`\`\`\n\nEnjoy!`
    const segs = parseArtifactSegments(text)
    const art = segs.find((s) => s.type === "artifact")
    expect(art).toBeTruthy()
    expect(art).toMatchObject({ type: "artifact", ext: "html", name: "page.html" })
    expect((art as { content: string }).content).toContain("<title>Sunset</title>")
    // text on both sides is preserved, in order
    expect(segs[0]).toMatchObject({ type: "text" })
    expect(segs[segs.length - 1]).toMatchObject({ type: "text", text: expect.stringContaining("Enjoy!") })
  })

  test("a full-HTML block with NO language tag still cards as html", () => {
    const segs = parseArtifactSegments("```\n" + bigHtml + "\n```")
    expect(segs.some((s) => s.type === "artifact" && s.ext === "html")).toBe(true)
  })

  test("svg and markdown render; js/python/other do NOT", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>`
    expect(hasArtifact("```svg\n" + svg + "\n```")).toBe(true)
    expect(hasArtifact("```md\n# Title\n\n" + "lorem ipsum ".repeat(10) + "\n```")).toBe(true)
    expect(hasArtifact("```js\nconsole.log('a very long but non-renderable code sample here ok')\n```")).toBe(false)
    expect(hasArtifact("```python\nprint('x' * 100)  # long but not renderable\n```")).toBe(false)
  })

  test("tiny renderable snippets below the size floor stay as text (no card spam)", () => {
    const tiny = "```html\n<b>hi</b>\n```"
    expect("<b>hi</b>".length).toBeLessThan(MIN_ARTIFACT_CHARS)
    expect(hasArtifact(tiny)).toBe(false)
    expect(parseArtifactSegments(tiny)).toEqual([{ type: "text", text: tiny }])
  })

  test("an UNCLOSED fence (still streaming) stays text until it closes", () => {
    const streaming = "Here you go:\n```html\n" + bigHtml // no closing ```
    expect(hasArtifact(streaming)).toBe(false)
    const closed = streaming + "\n```"
    expect(hasArtifact(closed)).toBe(true)
  })

  test("multiple artifacts get distinct, type-suffixed names", () => {
    const svg = `<svg width="10" height="10"><rect width="10" height="10"/></svg>`.padEnd(MIN_ARTIFACT_CHARS + 5, " ")
    const text = "```html\n" + bigHtml + "\n```\nand\n```html\n" + bigHtml + "\n```\nand\n```svg\n" + svg + "\n```"
    const names = parseArtifactSegments(text)
      .filter((s) => s.type === "artifact")
      .map((s) => (s as { name: string }).name)
    expect(names).toEqual(["page.html", "page-2.html", "image.svg"])
  })
})
