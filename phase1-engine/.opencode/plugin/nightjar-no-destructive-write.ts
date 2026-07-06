// Nightjar Safety Plugin A — no destructive whole-file write.
//
// Phase 1 failure this guards against: a small model's `edit` call failed
// validation (empty oldString), and the model then called `write` with a tiny
// stub as the ENTIRE file content, destroying all existing code. The `edit`
// tool itself never falls back to a full write (it throws) — the destruction
// came from the model choosing `write`. So we gate `write` here.
//
// Policy: block a `write` to an EXISTING, non-trivial file when the new content
// would drop most of the file's size AND fails to preserve most of its lines.
// Legitimate cases (new files, full regenerations that keep/expand content,
// growth) are allowed. Rejection throws an instructive Error whose message is
// fed back to the model as the tool result (OpenCode routes thrown errors from
// tool.execute.before into a tool-error part → model-facing text), steering it
// back to `edit`.

import type { Plugin } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "node:fs"
import { isAbsolute, join } from "node:path"

// --- tunable thresholds (kept explicit so the policy is auditable) ---
const MIN_PROTECTED_CHARS = 40 // files smaller than this aren't worth protecting
const SHRINK_BLOCK_RATIO = 0.5 // new < 50% of old size is suspicious
const LINE_PRESERVATION_MIN = 0.5 // a legit rewrite keeps >=50% of old non-empty lines

function nonEmptyLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
}

function preservedFraction(oldText: string, newText: string): number {
  const oldLines = nonEmptyLines(oldText)
  if (oldLines.length === 0) return 1
  const newSet = new Set(nonEmptyLines(newText))
  const kept = oldLines.filter((l) => newSet.has(l)).length
  return kept / oldLines.length
}

export const NightjarNoDestructiveWrite: Plugin = async ({ directory, worktree }) => {
  const root = worktree || directory || process.cwd()
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "write") return
      const args = output.args as { filePath?: string; content?: string }
      if (!args?.filePath || typeof args.content !== "string") return

      const filepath = isAbsolute(args.filePath) ? args.filePath : join(root, args.filePath)
      if (!existsSync(filepath)) return // new file — allowed

      let oldText: string
      try {
        oldText = readFileSync(filepath, "utf8")
      } catch {
        return // can't read (binary/perm) — don't interfere
      }

      const oldChars = oldText.trim().length
      const newChars = args.content.trim().length
      if (oldChars < MIN_PROTECTED_CHARS) return // trivially small existing file
      if (newChars >= oldChars * SHRINK_BLOCK_RATIO) return // not a big shrink — allowed

      const preserved = preservedFraction(oldText, args.content)
      if (preserved >= LINE_PRESERVATION_MIN) return // keeps most content — legit rewrite

      // Destructive overwrite detected.
      const oldLines = nonEmptyLines(oldText).length
      const newLines = nonEmptyLines(args.content).length
      console.error(
        `[nightjar-safety] BLOCKED destructive write to ${args.filePath}: ` +
          `${oldChars}->${newChars} chars, ${oldLines}->${newLines} non-empty lines, ` +
          `${Math.round(preserved * 100)}% of original lines preserved.`,
      )
      throw new Error(
        `Refusing to overwrite ${args.filePath}: this write would delete most of the file ` +
          `(${oldChars} chars / ${oldLines} lines down to ${newChars} chars / ${newLines} lines, ` +
          `only ${Math.round(preserved * 100)}% of existing lines preserved). ` +
          `If your goal is a small change, use the 'edit' tool with a precise oldString/newString ` +
          `instead of rewriting the whole file. If you truly intend a full rewrite, include the ` +
          `existing content you want to keep.`,
      )
    },
  }
}
