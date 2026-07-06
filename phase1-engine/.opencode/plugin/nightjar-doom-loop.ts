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
//   - independent stricter counter: block the Nth identical (tool+args) call
//     directly from tool.execute.before, so repetition is caught even if the
//     built-in detector's exact-history condition doesn't line up.

import type { Plugin } from "@opencode-ai/plugin"
import { createHash } from "node:crypto"

const STRICT_REPEAT = 3 // block the 3rd identical (tool,args) call in a session

const countsBySession = new Map<string, Map<string, number>>()

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

    "tool.execute.before": async (input, output) => {
      const sid = input.sessionID
      let counts = countsBySession.get(sid)
      if (!counts) {
        counts = new Map()
        countsBySession.set(sid, counts)
      }
      const k = key(input.tool, (output as { args: unknown }).args)
      const n = (counts.get(k) ?? 0) + 1
      counts.set(k, n)
      if (n >= STRICT_REPEAT) {
        console.error(
          `[nightjar-doom-loop] BLOCKED: '${input.tool}' called with identical args ${n} times this session.`,
        )
        throw new Error(
          `Doom-loop guard: you have called '${input.tool}' with identical arguments ${n} times. ` +
            `Stop repeating the same call — the result will not change. Re-read the previous tool ` +
            `output, change your approach, or explain what is blocking you.`,
        )
      }
    },
  }
}
