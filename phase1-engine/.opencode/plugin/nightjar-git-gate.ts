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

// per-CALL state (NOT per-session). Scoping intent to the whole session let a
// later call that accidentally corrupts an earlier target off the hook (the
// target was still "intended" from before), so the rollback never ran. The
// preexisting-dirty snapshot below is what legitimately protects earlier edits
// — so per-call intent is both correct and tighter.
const intendedByCall = new Map<string, Set<string>>() // callID -> absolute paths this call targets
const preexistingByCall = new Map<string, Set<string>>() // callID -> dirty-before set (repo-relative)

// Extract the file path(s) a gated tool call intends to touch, across arg shapes:
//   edit / write            → args.filePath (single file)
//   apply_patch / patch     → args.patchText (multi-file) — parse paths out of it
// Returns absolute paths. If this returns empty for a gated call, the gate MUST
// fail open (never roll back edits it can't attribute — over-broad rollback is
// itself data loss, the exact failure this plugin exists to prevent).
function intendedPaths(args: Record<string, unknown> | undefined, root: string): string[] {
  const toAbs = (p: string) => (isAbsolute(p) ? p : join(root, p))
  const out: string[] = []
  for (const k of ["filePath", "path"]) {
    const v = args?.[k]
    if (typeof v === "string" && v.trim()) out.push(toAbs(v.trim()))
  }
  const patch = args?.["patchText"] ?? args?.["patch"] ?? args?.["diff"]
  if (typeof patch === "string") {
    // OpenAI apply_patch envelope: "*** Add|Update|Delete File: <path>" / "*** Move to: <path>"
    for (const m of patch.matchAll(/^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s+(.+?)\s*$/gm)) out.push(toAbs(m[1]))
    for (const m of patch.matchAll(/^\*\*\*\s+Move\s+to:\s+(.+?)\s*$/gm)) out.push(toAbs(m[1]))
    // unified-diff fallback: "+++ b/<path>"
    for (const m of patch.matchAll(/^\+\+\+\s+b\/(.+?)\s*$/gm)) out.push(toAbs(m[1]))
  }
  return out
}

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
      // record THIS call's intended target(s), across tool arg shapes
      const paths = intendedPaths(output.args as Record<string, unknown> | undefined, root)
      intendedByCall.set(input.callID, new Set(paths))
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
      const intended = intendedByCall.get(input.callID) ?? new Set<string>()
      intendedByCall.delete(input.callID)
      const preexisting = preexistingByCall.get(input.callID) ?? new Set<string>()
      preexistingByCall.delete(input.callID)

      // FAIL OPEN: if we couldn't attribute any intended path to this gated call
      // (e.g. a patch tool whose arg shape we didn't parse), do NOT roll anything
      // back — rolling back the agent's own edits because we can't classify them
      // is worse than not gating. Log and skip enforcement for this call.
      if (intended.size === 0) {
        console.error(
          `[nightjar-git-gate] no intended path resolved for ${input.tool} (callID ${input.callID}); ` +
            `scope check skipped (no rollback).`,
        )
        return
      }
      const intendedRel = new Set(Array.from(intended).map((p) => relative(root, p)))

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
