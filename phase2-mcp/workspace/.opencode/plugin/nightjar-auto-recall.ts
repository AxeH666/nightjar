// Nightjar auto-recall plugin.
//
// Row-Bot injected recalled long-term memories into the prompt from inside its
// own LangGraph turn. MCP servers don't see the full prompt pipeline, so per the
// audit that logic moves here — an OpenCode `chat.message` hook that, for each
// substantive user message, queries Nightjar's memory store and (only when a
// high-confidence match exists) prepends a recalled-memory block to the user's
// text. The "when to recall" decision lives in recall.py (score threshold + cap).

import type { Plugin } from "@opencode-ai/plugin"

const PY = "/home/axehe/nightjar/phase2-mcp/venv/bin/python"
const RECALL = "/home/axehe/nightjar/phase2-mcp/recall.py"

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
      try {
        recalled = (await $`${PY} ${RECALL} ${userText}`.quiet().text()).trim()
      } catch {
        return // memory offline — never block the turn
      }
      if (!recalled) return

      const block = `[Nightjar recalled memory]\n${recalled}\n[end recalled memory]\n\n`
      // prepend to the first text part so the model sees the context before the ask
      textParts[0].text = block + textParts[0].text
      console.error(`[nightjar-auto-recall] injected ${recalled.split("\n").length} memory line(s)`)
    },
  }
}
