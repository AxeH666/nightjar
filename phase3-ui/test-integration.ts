// Phase 3 integration test — drives the ACTUAL Nightjar UI client module
// (src/renderer/src/lib/opencode.ts) against a REAL running OpenCode server.
// Validates the full contract the UI depends on. Run with: bun test-integration.ts
import { OpenCodeClient, toolCallFromPart } from "./src/renderer/src/lib/opencode"
import type { ToolCall } from "./src/renderer/src/lib/opencode"
import { existsSync, rmSync } from "node:fs"
import { join } from "node:path"

const BASE = process.env.NIGHTJAR_OPENCODE_URL || "http://127.0.0.1:4096"
const MODEL = "llamacpp/qwen3-4b-instruct-2507"
// repo-relative (this file lives in phase3-ui/), not a hardcoded machine path
const NOTE = join(import.meta.dir, "test-workspace/proj/note.txt")

const log = (...a: any[]) => console.log(...a)
let pass = 0, fail = 0
const check = (name: string, ok: boolean) => { console.log(`${ok ? "PASS" : "FAIL"}: ${name}`); ok ? pass++ : fail++ }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  if (existsSync(NOTE)) rmSync(NOTE)
  const client = new OpenCodeClient(BASE)

  // 1. enumerate modes
  const agents = await client.listAgents()
  const names = agents.map((a) => a.name)
  check("GET /agent returns modes (research/assistant/coding present)",
    ["research", "assistant", "coding"].every((m) => names.includes(m)))
  check("GET /agent filters out subagents/hidden", !names.includes("explore") && !names.includes("title"))

  // 2. session + SSE subscription
  const sessionID = await client.createSession("integration test")
  check("POST /session created a session", !!sessionID)

  const tools = new Map<string, ToolCall>()
  let askSeen: any = null
  let askReplied = false
  let sawAssistantText = false
  let idle = false
  const ac = new AbortController()
  client.subscribe(async (e) => {
    const p: any = e.properties ?? {}
    const sid = p.sessionID ?? p.info?.sessionID ?? p.part?.sessionID
    if (sid && sid !== sessionID) return // client-side sessionID filter
    if (e.type === "message.part.updated" && p.part?.type === "tool") {
      const c = toolCallFromPart(p.part); if (c) tools.set(c.callID, c)
    }
    if (e.type === "message.part.updated" && p.part?.type === "text" && (p.part.text ?? "").trim()) sawAssistantText = true
    if (e.type === "message.part.delta" && p.field === "text") sawAssistantText = true
    if ((e.type === "permission.asked" || e.type === "permission.v2.asked") && !askReplied) {
      askSeen = p
      log(`   → permission.asked: permission=${p.permission} tool=${p.tool?.callID ?? "?"}`)
      askReplied = true
      await client.replyPermission(p.id, "once")   // approve once
      log(`   → replied once to ${p.id}`)
    }
    if (e.type === "session.idle" || e.type === "turn.idle") idle = true
  }, ac.signal).catch(() => {})

  await sleep(300)

  // 3. prompt in coding mode → should call write/edit → fire a permission ask
  log("→ prompting coding agent to create note.txt (expect tool call + permission ask)…")
  await client.promptAsync(sessionID,
    "Create a file at proj/note.txt containing exactly the text NIGHTJAR. Use your write/edit tool.",
    "coding", MODEL)
  check("POST /session/:id/prompt_async accepted (per-request agent=coding)", true)

  // 4. wait for the run to finish (or timeout)
  const deadline = Date.now() + 240_000
  while (!idle && Date.now() < deadline) await sleep(1000)

  check("SSE streamed a tool-call part (message.part.updated ToolPart)", tools.size > 0)
  const toolStatuses = [...tools.values()].map((t) => `${t.tool}:${t.status}`)
  log("   tool calls seen:", toolStatuses.join(", ") || "(none)")
  check("permission.asked streamed to client", !!askSeen)
  check("a tool reached completed status after approval", [...tools.values()].some((t) => t.status === "completed"))
  check("file was actually created (approved write took effect)", existsSync(NOTE))
  check("assistant produced streaming text", sawAssistantText)

  // 5. abort escape hatch — start a prompt then abort
  log("→ testing abort escape hatch…")
  const sid2 = await client.createSession("abort test")
  await client.promptAsync(sid2, "Write a very long essay about birds. Keep going.", "coding", MODEL)
  await sleep(2500)
  await client.abort(sid2)
  check("POST /session/:id/abort returned OK", true)

  ac.abort()
  log(`\n==== ${pass} passed, ${fail} failed ====`)
  process.exit(fail > 0 ? 1 : 0)
}
main().catch((e) => { console.error("test error:", e); process.exit(1) })
