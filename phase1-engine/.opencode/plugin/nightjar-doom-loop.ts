// Nightjar Safety Plugin C — tighten doom-loop handling.
//
// OpenCode already detects 3 consecutive byte-identical tool calls
// (DOOM_LOOP_THRESHOLD = 3 in session/processor.ts) and raises a `doom_loop`
// PERMISSION request. Problem found in testing: in headless/autonomous mode the
// loop breaker is defeated two ways —
//   (1) `--auto` auto-APPROVES the doom_loop permission, so the loop continues;
//   (2) without `--auto`, an unattended run cannot answer the prompt.
// Neither actually stops the loop autonomously.
//
// This plugin makes it a hard stop without a human:
//   - permission.ask hook: force `doom_loop` requests to `deny`.
//   - independent stricter counter: block the Nth CONSECUTIVE identical (tool+args)
//     call directly from tool.execute.before, so repetition is caught even if the
//     built-in detector's exact-history condition doesn't line up.
//
// P2-12 fixes to the counter (its first version over-blocked and leaked):
//   - Count CONSECUTIVE identical calls only — a DIFFERENT call resets the run. The
//     old cumulative-per-session count blocked any (tool,args) that recurred 3× ANYWHERE
//     in a session (even interleaved with other work) and then blocked it forever.
//   - Exclude read-only tools (read/grep/glob/list): re-reading a file after an edit or
//     re-grepping the same pattern is legitimate, never a doom-loop.
//   - Evict per-session state on session idle/deleted so the Map can't grow unbounded.
// A real doom-loop is a model firing the SAME side-effecting call over and over within one
// active turn — still exactly what consecutive-counting catches.

import type { Plugin } from "@opencode-ai/plugin"
import { createHash } from "node:crypto"

const STRICT_REPEAT = 3 // block the 3rd CONSECUTIVE identical (tool,args) call in a turn

// Read-only tools legitimately repeat — their repetition is never a doom-loop.
const READONLY_TOOLS = new Set(["read", "grep", "glob", "list"])

// Per session, track ONLY the current consecutive run: the last (tool,args) key and how
// many times in a row it has occurred. A different call resets it; idle/delete evicts it.
const runBySession = new Map<string, { key: string; count: number }>()

function key(tool: string, args: unknown): string {
  return createHash("sha1").update(tool).update("\0").update(JSON.stringify(args ?? null)).digest("hex")
}

export const NightjarDoomLoop: Plugin = async () => {
  return {
    "permission.ask": async (input: any, output: { status: "ask" | "deny" | "allow" }) => {
      if (input?.permission === "doom_loop") {
        console.error(`[nightjar-doom-loop] hard-denying built-in doom_loop permission (headless-safe stop).`)
        output.status = "deny"
      }
    },

    // Evict a session's run when its turn ends (idle) or it's deleted, so the map only ever
    // holds active sessions. Idle also resets the run at a turn boundary — harmless, since a
    // doom-loop lives inside one active turn (the session never goes idle mid-loop).
    event: async ({ event }: { event: any }) => {
      if (event?.type === "session.idle") runBySession.delete(event.properties?.sessionID)
      else if (event?.type === "session.deleted") runBySession.delete(event.properties?.info?.id)
    },

    "tool.execute.before": async (input, output) => {
      if (READONLY_TOOLS.has(input.tool)) return // read-only repetition is never a loop
      const sid = input.sessionID
      const k = key(input.tool, (output as { args: unknown }).args)
      const run = runBySession.get(sid)
      const count = run && run.key === k ? run.count + 1 : 1 // consecutive: reset on a different call
      runBySession.set(sid, { key: k, count })
      if (count >= STRICT_REPEAT) {
        console.error(
          `[nightjar-doom-loop] BLOCKED: '${input.tool}' called with identical args ${count} times in a row.`,
        )
        throw new Error(
          `Doom-loop guard: you have called '${input.tool}' with identical arguments ${count} times in a row. ` +
            `Stop repeating the same call — the result will not change. Re-read the previous tool ` +
            `output, change your approach, or explain what is blocking you.`,
        )
      }
    },
  }
}
