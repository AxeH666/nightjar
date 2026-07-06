// Unit test for the attachment send contract: OpenCodeClient.promptAsync must build
// the exact `parts` array OpenCode expects — a text part plus `file` parts whose
// `url` is a base64 data URL. Run: bun test-attachments.ts
import { OpenCodeClient } from "./src/renderer/src/lib/opencode"

let pass = 0,
  fail = 0
const check = (n: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${n}${extra ? " — " + extra : ""}`)
  ok ? pass++ : fail++
}

let captured: { url: string; body: any } | null = null
;(globalThis as any).fetch = async (url: string, init: any) => {
  captured = { url, body: JSON.parse(init.body) }
  return { ok: true, status: 204, text: async () => "" } as any
}

const client = new OpenCodeClient("http://127.0.0.1:4096")

// 1) text + one image attachment
await client.promptAsync("sess1", "what is this?", "assistant", "openai/gpt-4o", [
  { mime: "image/png", url: "data:image/png;base64,AAAA", filename: "shot.png" },
])
{
  const b = captured!.body
  check("posts to prompt_async", captured!.url.endsWith("/session/sess1/prompt_async"))
  check("agent forwarded", b.agent === "assistant")
  check("model → ModelRef object", b.model?.providerID === "openai" && b.model?.modelID === "gpt-4o", JSON.stringify(b.model))
  check("parts[0] is the text part", b.parts?.[0]?.type === "text" && b.parts[0].text === "what is this?")
  const fp = b.parts?.[1]
  check("parts[1] is a file part", fp?.type === "file", JSON.stringify(fp))
  check("file part mime", fp?.mime === "image/png")
  check("file part url is a base64 data URL", typeof fp?.url === "string" && fp.url.startsWith("data:image/png;base64,"))
  check("file part filename", fp?.filename === "shot.png")
}

// 2) text only → exactly one text part, no file part
await client.promptAsync("sess1", "just text", "coding")
{
  const b = captured!.body
  check("text-only → single text part", b.parts.length === 1 && b.parts[0].type === "text")
  check("no model key when unset", !("model" in b))
}

// 3) multiple attachments preserved in order
await client.promptAsync("sess1", "two files", "assistant", undefined, [
  { mime: "image/jpeg", url: "data:image/jpeg;base64,BBBB", filename: "a.jpg" },
  { mime: "application/pdf", url: "data:application/pdf;base64,CCCC", filename: "doc.pdf" },
])
{
  const b = captured!.body
  check("3rd request: 1 text + 2 file parts", b.parts.length === 3)
  check("2nd file part is the pdf", b.parts[2].type === "file" && b.parts[2].mime === "application/pdf")
}

console.log(`\n==== attachments contract: ${pass} passed, ${fail} failed ====`)
process.exit(fail > 0 ? 1 : 0)
