// Nightjar Safety Plugin D — generation length cap.
//
// Complements the inference timeout proxy (wall-clock) with a TOKEN cap on each
// model call. A runaway repetition loop (the Phase 1.5 "stuck generation") emits
// tokens toward the context limit; capping maxOutputTokens makes it stop early
// and cheaply, usually before the wall-clock deadline is even reached. The two
// are complementary: token cap bounds length, the proxy bounds time.
//
// Uses the `chat.params` hook, whose `output.maxOutputTokens` is passed straight
// into the AI SDK `streamText` call (packages/opencode/src/session/llm.ts:320).
// Only lowers an existing cap (never raises one a caller set intentionally).
// Configurable via NIGHTJAR_MAX_OUTPUT_TOKENS (default 2048).

import type { Plugin } from "@opencode-ai/plugin"

const DEFAULT_CAP = 2048
// Validate the env override: a non-numeric / non-positive value (e.g. "2k", "",
// "-1") must NOT silently produce NaN — that would make `current > CAP` always
// false and defeat the cap. Fall back to the default in that case.
const _capEnv = Number(process.env.NIGHTJAR_MAX_OUTPUT_TOKENS)
const CAP = Number.isFinite(_capEnv) && _capEnv > 0 ? Math.floor(_capEnv) : DEFAULT_CAP

export const NightjarGenerationCap: Plugin = async () => {
  return {
    "chat.params": async (_input, output) => {
      const current = output.maxOutputTokens
      if (current === undefined || current > CAP) {
        output.maxOutputTokens = CAP
      }
    },
  }
}
