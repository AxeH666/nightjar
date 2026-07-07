// End-to-end test of the live-preview DATA PATH against the REAL OpenCode stack
// (needs llama + proxy + opencode on :4096, coding workspace). Proves: the coding
// agent's write tool-call events carry file content → the renderer's extraction
// helper (artifactActionFromTool) reads it → the main preview-server mirrors it →
// the loopback server serves the generated page/doc. The only piece NOT covered
// here is the literal Electron <iframe> pixels (needs a display).
// Run (stack up): NIGHTJAR_OPENCODE_URL=http://127.0.0.1:4096 bun test-preview-e2e.ts
import { OpenCodeClient } from "./src/renderer/src/lib/opencode"
import { artifactActionFromTool } from "./src/renderer/src/lib/preview"
import type { ToolCall } from "./src/renderer/src/lib/opencode"
import { toolCallFromPart } from "./src/renderer/src/lib/opencode"
import { writePreviewFile, editPreviewFile, listPreview, previewUrl, normalizeRel, stopServer, sandboxRoot } from "./src/main/preview-server"
import { rm } from "node:fs/promises"

const BASE = process.env.NIGHTJAR_OPENCODE_URL || "http://127.0.0.1:4096"
const MODEL = "llamacpp/qwen3-4b-instruct-2507"
const WS = process.env.NIGHTJAR_WORKSPACE || "/home/axehe/nightjar/phase2-odysseus/workspace"
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
let pass = 0, fail = 0
const check = (n: string, ok: boolean, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${n}${extra ? " — " + extra : ""}`); ok ? pass++ : fail++ }

// Mirror a write/edit tool call exactly as App.upsertTool would, into `sid`'s sandbox.
const growth = new Map<string, number[]>() // callID → observed content lengths (streaming granularity)
async function mirror(sid: string, call: ToolCall): Promise<void> {
  const a = artifactActionFromTool(call)
  if (!a) return
  if (a.kind === "write") {
    const arr = growth.get(call.callID) ?? []; arr.push(a.content.length); growth.set(call.callID, arr)
    await writePreviewFile(sid, normalizeRel(a.filePath, WS), a.content)
  } else {
    await editPreviewFile(sid, normalizeRel(a.filePath, WS), a.oldString, a.newString, a.replaceAll)
  }
}

async function runPrompt(client: OpenCodeClient, sid: string, text: string): Promise<void> {
  let idle = false
  const ac = new AbortController()
  client.subscribe(async (e) => {
    const p: any = e.properties ?? {}
    const s = p.sessionID ?? p.info?.sessionID ?? p.part?.sessionID
    if (s && s !== sid) return
    if (e.type === "message.part.updated" && p.part?.type === "tool") {
      await mirror(sid, toolCallFromPart(p.part)!)
    }
    if ((e.type === "permission.asked" || e.type === "permission.v2.asked")) {
      await client.replyPermission(p.id, "always").catch(() => {})
    }
    if (e.type === "session.idle" || e.type === "turn.idle") idle = true
  }, ac.signal).catch(() => {})
  await sleep(300)
  await client.promptAsync(sid, text, "coding", MODEL)
  const deadline = Date.now() + 240_000
  while (!idle && Date.now() < deadline) await sleep(1000)
  ac.abort()
}

const client = new OpenCodeClient(BASE)
const sid = await client.createSession("preview e2e")
try {
  // A) coffee shop landing page → preview/index.html
  console.log("→ A: coffee shop landing page")
  // Keep it concise so the whole write tool-call fits the local model's --predict
  // budget (a huge single file truncates → tool error; see KNOWN_ISSUES NJ-8).
  await runPrompt(client, sid, "Build a simple landing page for a coffee shop as preview/index.html — one concise self-contained HTML file, inline CSS, keep it short. Use your write tool.")
  const filesA = await listPreview(sid)
  console.log("   mirrored files:", filesA.map(f => f.path).join(", ") || "(none)")
  const htmlEntry = filesA.find(f => /\.html?$/i.test(f.path))
  check("A: an HTML artifact was mirrored", !!htmlEntry, htmlEntry?.path)
  if (htmlEntry) {
    const url = await previewUrl(sid, htmlEntry.path)
    const r = await fetch(url); const body = await r.text()
    check("A: server renders the page (200 + <html>)", r.status === 200 && /<html|<!doctype/i.test(body), `${r.status}, ${body.length}b`)
    check("A: page mentions coffee", /coffee/i.test(body))
    // streaming granularity report (not a pass/fail — informational)
    const g = [...growth.values()].find(a => a.length) ?? []
    console.log(`   streaming granularity: ${g.length} content snapshot(s) [${g.slice(0, 6).join(",")}${g.length > 6 ? "…" : ""}] → ${g.length > 1 ? "PROGRESSIVE (typewriter)" : "atomic (per-file)"}`)
  }

  // B) markdown doc → renders to HTML in the preview
  console.log("→ B: markdown doc")
  await runPrompt(client, sid, "Write a short markdown document as preview/notes.md describing three coffee brewing methods. Only write that one file.")
  const filesB = await listPreview(sid)
  const mdEntry = filesB.find(f => /\.md$/i.test(f.path))
  check("B: a markdown artifact was mirrored", !!mdEntry, mdEntry?.path)
  if (mdEntry) {
    const r = await fetch(await previewUrl(sid, mdEntry.path)); const body = await r.text()
    check("B: markdown served as rendered HTML", (r.headers.get("content-type") || "").includes("text/html") && /<h1|<h2|<ul|<p/i.test(body), body.slice(0, 60))
  }
} finally {
  stopServer()
  await rm(sandboxRoot(sid), { recursive: true, force: true }).catch(() => {})
}
console.log(`\n==== preview e2e: ${pass} passed, ${fail} failed ====`)
process.exit(fail > 0 ? 1 : 0)
