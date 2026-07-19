// Nightjar auto-recall plugin.
//
// Row-Bot injected recalled long-term memories into the prompt from inside its
// own LangGraph turn. MCP servers don't see the full prompt pipeline, so per the
// audit that logic moves here — an OpenCode `chat.message` hook that, for each
// substantive user message, queries Nightjar's memory store and (only when a
// high-confidence match exists) prepends a recalled-memory block to the user's
// text. The "when to recall" decision lives in recall.py (score threshold + cap).

import type { Plugin } from "@opencode-ai/plugin"
import { join } from "node:path"
import { homedir } from "node:os"

// Repo-relative, not hardcoded to one machine. NIGHTJAR_ROOT is set by the
// Electron supervisor (services.ts) and the setup script; falls back to ~/nightjar.
const ROOT = process.env.NIGHTJAR_ROOT || join(homedir(), "nightjar")
// OS-correct venv interpreter (Scripts\python.exe on Windows). Hardcoding bin/python meant recall
// silently never fired on Windows — the spawn threw and the catch no-op'd (audit1.md P2-11).
// NJ_VENV_PY is set by the supervisor's opencode-serve env; fall back to a platform default.
const VENV_PY = process.env.NJ_VENV_PY || (process.platform === "win32" ? "Scripts/python.exe" : "bin/python")
const PY = join(ROOT, "phase2-mcp/venv", VENV_PY)
const RECALL = join(ROOT, "phase2-mcp/recall.py")
// Bound the per-message recall so a cold/stuck memory store can't wedge the chat turn (rule 3).
const RECALL_TIMEOUT_MS = Number(process.env.NIGHTJAR_RECALL_TIMEOUT_MS || 8000)
let recallWarned = false // log the "memory offline" reason ONCE, not on every message

export const NightjarAutoRecall: Plugin = async ({ $ }) => {
  return {
    "chat.message": async (_input, output) => {
      // gather the user's text from the message parts
      const textParts = (output.parts as any[]).filter((p) => p?.type === "text" && typeof p.text === "string")
      if (textParts.length === 0) return
      const userText = textParts.map((p) => p.text).join(" ").trim()
      if (userText.length < 4) return
      // already-injected guard (avoid recursion / double inject)
      if (userText.startsWith("[Nightjar recalled memory]")) return

      let recalled = ""
      // This hook runs on EVERY substantive message before the turn proceeds, so bound the
      // subprocess: a hung Chroma/cold-model query must not wedge the chat turn (rule 3).
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        recalled = (
          await Promise.race([
            $`${PY} ${RECALL} ${userText}`.quiet().text(),
            new Promise<string>((_, rej) => {
              timer = setTimeout(() => rej(new Error("recall timed out")), RECALL_TIMEOUT_MS)
            }),
          ])
        ).trim()
      } catch (e) {
        // memory offline / timed out — never block the turn; log the reason ONCE (not per message)
        if (!recallWarned) {
          recallWarned = true
          console.error(`[nightjar-auto-recall] recall unavailable (memory offline or timed out): ${e}`)
        }
        return
      } finally {
        // Clear the armed timeout when recall.py won the race — otherwise it fires later (after a
        // SUCCESSFUL recall, on nearly every message) and rejects a promise nobody awaits, an
        // unhandled rejection. Bounded caller only: on a genuine timeout the short recall script
        // is left to finish on its own; the chat turn is already unblocked.
        if (timer !== undefined) clearTimeout(timer)
      }
      if (!recalled) return

      const block = `[Nightjar recalled memory]\n${recalled}\n[end recalled memory]\n\n`
      // prepend to the first text part so the model sees the context before the ask
      textParts[0].text = block + textParts[0].text
      console.error(`[nightjar-auto-recall] injected ${recalled.split("\n").length} memory line(s)`)
    },
  }
}
