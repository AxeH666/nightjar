// Nightjar Safety Plugin B — git-gate every edit.
//
// After each successful edit/write, verify (via `git status --porcelain`) that
// the only files that changed BECAUSE OF this tool call are files the agent
// explicitly targeted this session. Anything that became newly dirty outside
// that intended scope is rolled back:
//   - modified tracked file  -> `git checkout -- <file>`
//   - newly created untracked -> `git clean -f -- <file>`
// In-scope changes are then committed as a per-edit checkpoint (opt-in via
// NIGHTJAR_GIT_CHECKPOINT=1), giving a recovery point and a clean baseline.
//
// CRITICAL correctness rule (learned the hard way): the gate must NOT touch
// files that were ALREADY dirty before the tool ran. It snapshots the set of
// dirty files in tool.execute.before and only considers files that transitioned
// clean->dirty during the call. Pre-existing uncommitted work is never rolled
// back, and the checkpoint only stages intended paths (never `git add -A`).
//
// Requires a git repo with a work tree; otherwise logs a warning and no-ops.

import type { Plugin } from "@opencode-ai/plugin"
import { isAbsolute, join, relative } from "node:path"

const GATED_TOOLS = new Set(["edit", "write", "apply_patch", "patch"])

// per-session state
const intendedBySession = new Map<string, Set<string>>() // absolute paths
const preexistingByCall = new Map<string, Set<string>>() // callID -> dirty-before set (repo-relative)

export const NightjarGitGate: Plugin = async ({ directory, worktree, $ }) => {
  const root = worktree || directory || process.cwd()

  async function isGitRepo(): Promise<boolean> {
    try {
      return (await $`git -C ${root} rev-parse --is-inside-work-tree`.quiet().text()).trim() === "true"
    } catch {
      return false
    }
  }

  async function dirtyFiles(): Promise<Array<{ path: string; untracked: boolean }>> {
    const out = await $`git -C ${root} status --porcelain`.quiet().text()
    const files: Array<{ path: string; untracked: boolean }> = []
    for (const line of out.split("\n")) {
      if (!line.trim()) continue
      const code = line.slice(0, 2)
      const p = line.slice(3).trim()
      const path = p.includes(" -> ") ? p.split(" -> ")[1] : p
      files.push({ path, untracked: code === "??" })
    }
    return files
  }

  const gitReady = await isGitRepo()
  if (!gitReady) {
    console.error(`[nightjar-git-gate] ${root} is not a git repo with a work tree — gate disabled.`)
  }

  return {
    "tool.execute.before": async (input, output) => {
      if (!gitReady || !GATED_TOOLS.has(input.tool)) return
      const args = output.args as { filePath?: string }
      // record intended target
      if (args?.filePath) {
        const abs = isAbsolute(args.filePath) ? args.filePath : join(root, args.filePath)
        let set = intendedBySession.get(input.sessionID)
        if (!set) {
          set = new Set()
          intendedBySession.set(input.sessionID, set)
        }
        set.add(abs)
      }
      // snapshot what was ALREADY dirty before this call — never our responsibility
      try {
        const before = new Set((await dirtyFiles()).map((f) => f.path))
        preexistingByCall.set(input.callID, before)
      } catch {
        preexistingByCall.set(input.callID, new Set())
      }
    },

    "tool.execute.after": async (input, output) => {
      if (!gitReady || !GATED_TOOLS.has(input.tool)) return
      const intended = intendedBySession.get(input.sessionID) ?? new Set<string>()
      const intendedRel = new Set(Array.from(intended).map((p) => relative(root, p)))
      const preexisting = preexistingByCall.get(input.callID) ?? new Set<string>()
      preexistingByCall.delete(input.callID)

      let changed: Array<{ path: string; untracked: boolean }>
      try {
        changed = await dirtyFiles()
      } catch (e) {
        console.error(`[nightjar-git-gate] git status failed: ${e}`)
        return
      }

      // out-of-scope = became dirty during this call, not intended, not already dirty before
      const outOfScope = changed.filter(
        (f) => !intendedRel.has(f.path) && !preexisting.has(f.path),
      )

      if (outOfScope.length > 0) {
        const rolledBack: string[] = []
        for (const f of outOfScope) {
          try {
            if (f.untracked) await $`git -C ${root} clean -fq -- ${f.path}`.quiet()
            else await $`git -C ${root} checkout -q -- ${f.path}`.quiet()
            rolledBack.push(f.path)
          } catch (e) {
            console.error(`[nightjar-git-gate] rollback failed for ${f.path}: ${e}`)
          }
        }
        console.error(
          `[nightjar-git-gate] out-of-scope change after ${input.tool} ` +
            `(intended: ${Array.from(intendedRel).join(", ") || "<none>"}); rolled back: ${rolledBack.join(", ")}`,
        )
        output.output = `${output.output}\n\n[nightjar-git-gate] Rolled back out-of-scope changes: ${rolledBack.join(", ")}`
      } else {
        console.error(`[nightjar-git-gate] scope OK after ${input.tool}: only intended files changed.`)
      }

      // checkpoint ONLY the intended files (never `git add -A`)
      if (process.env.NIGHTJAR_GIT_CHECKPOINT === "1" && intendedRel.size > 0) {
        try {
          for (const rel of intendedRel) await $`git -C ${root} add -- ${rel}`.quiet()
          const staged = (await $`git -C ${root} diff --cached --name-only`.quiet().text()).trim()
          if (staged) {
            await $`git -C ${root} commit -q -m ${`nightjar checkpoint: ${input.tool}`}`.quiet()
            console.error(`[nightjar-git-gate] checkpoint committed (${input.tool}): ${staged.replace(/\n/g, ", ")}`)
          }
        } catch (e) {
          console.error(`[nightjar-git-gate] checkpoint commit failed: ${e}`)
        }
      }
    },
  }
}
