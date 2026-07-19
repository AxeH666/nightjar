// Deterministic unit tests for the Nightjar safety plugins.
// Drives each plugin's hooks directly with controlled inputs (no model in the
// loop), so pass/fail is reproducible. Run with:  bun verify-plugins.ts
//
// Covers:
//  A) no-destructive-write: blocks tiny overwrite of existing file, allows
//     new-file / growth / content-preserving rewrites.
//  B) git-gate: rolls back an out-of-scope change made during a tool call,
//     keeps the intended change, and leaves PRE-EXISTING dirty files untouched.
//  C) doom-loop: blocks the 3rd identical (tool,args) call; forces the built-in
//     doom_loop permission to "deny".

import { $ } from "bun"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { NightjarNoDestructiveWrite } from "./.opencode/plugin/nightjar-no-destructive-write.ts"
import { NightjarGitGate } from "./.opencode/plugin/nightjar-git-gate.ts"
import { NightjarDoomLoop } from "./.opencode/plugin/nightjar-doom-loop.ts"
import { NightjarGenerationCap } from "./.opencode/plugin/nightjar-generation-cap.ts"

let pass = 0
let fail = 0
function check(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}`)
  cond ? pass++ : fail++
}
async function throws(fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn()
    return false
  } catch {
    return true
  }
}

const pluginInput = (dir: string): any => ({
  directory: dir,
  worktree: dir,
  $,
  client: {},
  project: {},
  serverUrl: new URL("http://localhost"),
  experimental_workspace: { register() {} },
})

// ---------- A) no-destructive-write ----------
async function testA() {
  console.log("\n== Plugin A: no-destructive-write ==")
  const dir = mkdtempSync(join(tmpdir(), "njA-"))
  const existing =
    "def greet(name):\n    return 'Hello, ' + name + '!'\n\n\nif __name__ == '__main__':\n    print(greet('World'))\n"
  writeFileSync(join(dir, "greet.py"), existing)
  const hooks = await NightjarNoDestructiveWrite(pluginInput(dir))
  const before = hooks["tool.execute.before"]!

  // 1. tiny overwrite of existing file -> BLOCK
  check(
    "blocks tiny overwrite of existing file",
    await throws(() => before({ tool: "write", sessionID: "s", callID: "1" }, { args: { filePath: "greet.py", content: "# placeholder" } })),
  )
  // 2. new (nonexistent) file -> ALLOW
  check(
    "allows write to a new file",
    !(await throws(() => before({ tool: "write", sessionID: "s", callID: "2" }, { args: { filePath: "brand-new.py", content: "x = 1" } }))),
  )
  // 3. content-preserving rewrite (keeps all lines + adds one) -> ALLOW
  check(
    "allows content-preserving rewrite (adds a docstring, keeps code)",
    !(await throws(() =>
      before(
        { tool: "write", sessionID: "s", callID: "3" },
        { args: { filePath: "greet.py", content: existing.replace("def greet(name):\n", "def greet(name):\n    '''doc'''\n") } },
      ),
    )),
  )
  // 4. growth (much larger) -> ALLOW
  check(
    "allows large growth write",
    !(await throws(() => before({ tool: "write", sessionID: "s", callID: "4" }, { args: { filePath: "greet.py", content: existing + "\n".repeat(50) + "# more".repeat(50) } }))),
  )
  // 5. non-write tool -> ignored (ALLOW)
  check(
    "ignores non-write tools",
    !(await throws(() => before({ tool: "read", sessionID: "s", callID: "5" }, { args: { filePath: "greet.py" } }))),
  )
  rmSync(dir, { recursive: true, force: true })
}

// ---------- B) git-gate ----------
async function testB() {
  console.log("\n== Plugin B: git-gate ==")
  const dir = mkdtempSync(join(tmpdir(), "njB-"))
  await $`git -C ${dir} init -q`.quiet()
  await $`git -C ${dir} config user.email t@t.local`.quiet()
  await $`git -C ${dir} config user.name t`.quiet()
  writeFileSync(join(dir, "target.py"), "print('target v1')\n")
  writeFileSync(join(dir, "other.py"), "print('other v1')\n")
  writeFileSync(join(dir, "preexisting.py"), "print('pre v1')\n")
  await $`git -C ${dir} add -A`.quiet()
  await $`git -C ${dir} commit -q -m base`.quiet()

  const hooks = await NightjarGitGate(pluginInput(dir))
  const before = hooks["tool.execute.before"]!
  const after = hooks["tool.execute.after"]!

  // Pre-existing dirty file (edited by the user, not this tool call)
  writeFileSync(join(dir, "preexisting.py"), "print('pre EDITED by user')\n")

  // Simulate an "edit" tool call targeting target.py
  await before({ tool: "edit", sessionID: "s", callID: "c1" }, { args: { filePath: "target.py" } })
  // ... during the call, the (hypothetical) tool changes target.py (intended) AND other.py (out-of-scope)
  writeFileSync(join(dir, "target.py"), "print('target v2 intended')\n")
  writeFileSync(join(dir, "other.py"), "print('other CORRUPTED out-of-scope')\n")
  await after({ tool: "edit", sessionID: "s", callID: "c1", args: { filePath: "target.py" } }, { title: "", output: "ok", metadata: {} })

  check("intended file kept (target.py = v2)", readFileSync(join(dir, "target.py"), "utf8").includes("v2 intended"))
  check("out-of-scope file rolled back (other.py = v1)", readFileSync(join(dir, "other.py"), "utf8").includes("other v1"))
  check(
    "pre-existing user edit left untouched (preexisting.py still EDITED)",
    readFileSync(join(dir, "preexisting.py"), "utf8").includes("EDITED by user"),
  )
  rmSync(dir, { recursive: true, force: true })
}

// B2) per-CALL scoping (Bugbot #6): a LATER call that corrupts an EARLIER call's
// (already-committed) target must still be rolled back — the earlier target is
// not in scope for the later call.
async function testB_perCall() {
  console.log("\n== Plugin B2: git-gate per-call scoping ==")
  const dir = mkdtempSync(join(tmpdir(), "njB2-"))
  await $`git -C ${dir} init -q`.quiet()
  await $`git -C ${dir} config user.email t@t.local`.quiet()
  await $`git -C ${dir} config user.name t`.quiet()
  writeFileSync(join(dir, "a.py"), "print('a v1')\n")
  writeFileSync(join(dir, "b.py"), "print('b v1')\n")
  await $`git -C ${dir} add -A`.quiet()
  await $`git -C ${dir} commit -q -m base`.quiet()

  const hooks = await NightjarGitGate(pluginInput(dir))
  const before = hooks["tool.execute.before"]!
  const after = hooks["tool.execute.after"]!

  // call 1: legitimately edit a.py, then COMMIT it (a.py is clean again).
  await before({ tool: "edit", sessionID: "s", callID: "c1" }, { args: { filePath: "a.py" } })
  writeFileSync(join(dir, "a.py"), "print('a v2 intended')\n")
  await after({ tool: "edit", sessionID: "s", callID: "c1", args: { filePath: "a.py" } }, { output: "ok" })
  await $`git -C ${dir} commit -q -am c1`.quiet()

  // call 2: edit b.py (intended) but ALSO corrupt a.py (side effect). a.py is NOT
  // this call's target and was clean (committed) → must be rolled back.
  await before({ tool: "edit", sessionID: "s", callID: "c2" }, { args: { filePath: "b.py" } })
  writeFileSync(join(dir, "b.py"), "print('b v2 intended')\n")
  writeFileSync(join(dir, "a.py"), "print('a CORRUPTED by later call')\n")
  await after({ tool: "edit", sessionID: "s", callID: "c2", args: { filePath: "b.py" } }, { output: "ok" })

  check("later call's intended file kept (b.py = v2)", readFileSync(join(dir, "b.py"), "utf8").includes("v2 intended"))
  check(
    "earlier target corrupted by a later call is rolled back (a.py = v2, not CORRUPTED)",
    readFileSync(join(dir, "a.py"), "utf8").includes("v2 intended") &&
      !readFileSync(join(dir, "a.py"), "utf8").includes("CORRUPTED"),
  )
  rmSync(dir, { recursive: true, force: true })
}

// B3) patch tools (Bugbot #7): apply_patch uses `patchText`, not `filePath`. The
// gate must extract intended paths from the patch and NOT roll back the patch's
// own legitimate edits.
async function testB_patch() {
  console.log("\n== Plugin B3: git-gate apply_patch path extraction ==")
  const dir = mkdtempSync(join(tmpdir(), "njB3-"))
  await $`git -C ${dir} init -q`.quiet()
  await $`git -C ${dir} config user.email t@t.local`.quiet()
  await $`git -C ${dir} config user.name t`.quiet()
  writeFileSync(join(dir, "patched.py"), "print('p v1')\n")
  writeFileSync(join(dir, "bystander.py"), "print('bystander v1')\n")
  await $`git -C ${dir} add -A`.quiet()
  await $`git -C ${dir} commit -q -m base`.quiet()

  const hooks = await NightjarGitGate(pluginInput(dir))
  const before = hooks["tool.execute.before"]!
  const after = hooks["tool.execute.after"]!

  const patchText = "*** Begin Patch\n*** Update File: patched.py\n@@\n-print('p v1')\n+print('p v2 intended')\n*** End Patch\n"
  await before({ tool: "apply_patch", sessionID: "s", callID: "p1" }, { args: { patchText } })
  writeFileSync(join(dir, "patched.py"), "print('p v2 intended')\n") // the patch's legit effect
  await after({ tool: "apply_patch", sessionID: "s", callID: "p1", args: { patchText } }, { output: "ok" })

  check(
    "apply_patch's own edit is KEPT (patched.py = v2, not rolled back)",
    readFileSync(join(dir, "patched.py"), "utf8").includes("v2 intended"),
  )
  check("untouched bystander stays clean", readFileSync(join(dir, "bystander.py"), "utf8").includes("bystander v1"))
  rmSync(dir, { recursive: true, force: true })
}

// B4) SUBDIR paths (audit1.md P1-3, Windows): a file in a SUBDIRECTORY that IS this call's
// intended target must be KEPT, not rolled back. On Windows relative() yields backslash paths
// (sub\target.py) while `git status` emits forward slashes (sub/target.py); without normalization
// they never match, so the agent's OWN edit is reverted (coding agent unusable on Windows). This
// test reproduces the failure on Windows and guards it everywhere.
async function testB_subdir() {
  console.log("\n== Plugin B4: git-gate subdir paths (P1-3, Windows) ==")
  const dir = mkdtempSync(join(tmpdir(), "njB4-"))
  await $`git -C ${dir} init -q`.quiet()
  await $`git -C ${dir} config user.email t@t.local`.quiet()
  await $`git -C ${dir} config user.name t`.quiet()
  mkdirSync(join(dir, "sub"), { recursive: true })
  writeFileSync(join(dir, "sub", "target.py"), "print('sub target v1')\n")
  writeFileSync(join(dir, "sub", "other.py"), "print('sub other v1')\n")
  await $`git -C ${dir} add -A`.quiet()
  await $`git -C ${dir} commit -q -m base`.quiet()

  const hooks = await NightjarGitGate(pluginInput(dir))
  const before = hooks["tool.execute.before"]!
  const after = hooks["tool.execute.after"]!

  // Edit call intends sub/target.py; during it edit the target (intended) + corrupt sub/other.py.
  await before({ tool: "edit", sessionID: "s", callID: "s1" }, { args: { filePath: "sub/target.py" } })
  writeFileSync(join(dir, "sub", "target.py"), "print('sub target v2 intended')\n")
  writeFileSync(join(dir, "sub", "other.py"), "print('sub other CORRUPTED')\n")
  await after({ tool: "edit", sessionID: "s", callID: "s1", args: { filePath: "sub/target.py" } }, { output: "ok" })

  check(
    "subdir intended file KEPT (sub/target.py = v2) — separator normalization",
    readFileSync(join(dir, "sub", "target.py"), "utf8").includes("v2 intended"),
  )
  check(
    "subdir out-of-scope file rolled back (sub/other.py = v1)",
    readFileSync(join(dir, "sub", "other.py"), "utf8").includes("sub other v1"),
  )
  rmSync(dir, { recursive: true, force: true })
}

// B5) NEW file in a NEW untracked subdir that IS this call's intended target must be KEPT. Default
// `git status --porcelain` collapses an untracked dir to `newdir/`; intendedRel has the FILE
// (newdir/created.py), so the mismatch flags `newdir/` out-of-scope and `git clean` wipes the
// whole dir INCLUDING the intended file. `--untracked-files=all` lists the file individually.
async function testB_newSubdir() {
  console.log("\n== Plugin B5: git-gate new file in new untracked subdir (-uall) ==")
  const dir = mkdtempSync(join(tmpdir(), "njB5-"))
  await $`git -C ${dir} init -q`.quiet()
  await $`git -C ${dir} config user.email t@t.local`.quiet()
  await $`git -C ${dir} config user.name t`.quiet()
  writeFileSync(join(dir, "base.py"), "print('base')\n")
  await $`git -C ${dir} add -A`.quiet()
  await $`git -C ${dir} commit -q -m base`.quiet()

  const hooks = await NightjarGitGate(pluginInput(dir))
  const before = hooks["tool.execute.before"]!
  const after = hooks["tool.execute.after"]!

  await before({ tool: "write", sessionID: "s", callID: "n1" }, { args: { filePath: "newdir/created.py" } })
  mkdirSync(join(dir, "newdir"), { recursive: true })
  writeFileSync(join(dir, "newdir", "created.py"), "print('created — intended')\n")
  await after({ tool: "write", sessionID: "s", callID: "n1", args: { filePath: "newdir/created.py" } }, { output: "ok" })

  check(
    "new file in a new untracked subdir KEPT (not clean-wiped) — untracked-files=all",
    existsSync(join(dir, "newdir", "created.py")) && readFileSync(join(dir, "newdir", "created.py"), "utf8").includes("intended"),
  )
  rmSync(dir, { recursive: true, force: true })
}

// ---------- C) doom-loop ----------
async function testC() {
  console.log("\n== Plugin C: doom-loop ==")
  const hooks = await NightjarDoomLoop({} as any)
  const before = hooks["tool.execute.before"]!
  const permAsk = hooks["permission.ask"]! as any
  const onEvent = hooks["event"]! as any

  // A side-effecting tool fired identically 3× IN A ROW is a loop → block the 3rd.
  const bash = (sid: string) => before({ tool: "bash", sessionID: sid, callID: "x" }, { args: { command: "ls" } })
  check("1st identical mutating call allowed", !(await throws(() => bash("s"))))
  check("2nd identical mutating call allowed", !(await throws(() => bash("s"))))
  check("3rd CONSECUTIVE identical mutating call BLOCKED", await throws(() => bash("s")))

  // Read-only tools are EXCLUDED (P2-12): re-grepping/re-reading identically must never block.
  const grep = () => before({ tool: "grep", sessionID: "ro", callID: "g" }, { args: { pattern: "foo" } })
  check("read-only grep allowed 1st", !(await throws(grep)))
  check("read-only grep allowed 2nd", !(await throws(grep)))
  check("read-only grep allowed 3rd (excluded — never a loop)", !(await throws(grep)))
  check("read-only grep allowed 4th (excluded)", !(await throws(grep)))

  // CONSECUTIVE-reset (P2-12): the same mutating call interleaved with a DIFFERENT call
  // resets the run, so legit repetition (A,B,A,B,A) never accumulates to a false block.
  const rid = "reset"
  const A = () => before({ tool: "bash", sessionID: rid, callID: "a" }, { args: { command: "make a" } })
  const B = () => before({ tool: "bash", sessionID: rid, callID: "b" }, { args: { command: "make b" } })
  check("interleaved A (run=1)", !(await throws(A)))
  check("interleaved B resets run", !(await throws(B)))
  check("interleaved A again (run=1, not 2)", !(await throws(A)))
  check("interleaved B again", !(await throws(B)))
  check("interleaved A once more — never 3-in-a-row, still allowed", !(await throws(A)))

  // Eviction (P2-12): session.idle clears the run (both leak control AND a turn-boundary
  // reset). After 2 consecutive, idle → the next 2 are allowed again (no stale false block).
  const eid = "evict"
  const w = () => before({ tool: "write", sessionID: eid, callID: "w" }, { args: { filePath: "x", content: "y" } })
  await w()
  await w() // run = 2 (not yet blocked)
  await onEvent({ event: { type: "session.idle", properties: { sessionID: eid } } })
  check("session.idle evicts the run (2 more allowed)", !(await throws(w)) && !(await throws(w)))
  await onEvent({ event: { type: "session.deleted", properties: { info: { id: eid } } } })
  check("session.deleted evicts too (allowed after)", !(await throws(w)))

  // permission.ask override
  const out = { status: "ask" as "ask" | "deny" | "allow" }
  await permAsk({ permission: "doom_loop" }, out)
  check("doom_loop permission forced to deny", out.status === "deny")
  const out2 = { status: "ask" as "ask" | "deny" | "allow" }
  await permAsk({ permission: "edit" }, out2)
  check("non-doom_loop permission left as ask", out2.status === "ask")
}

// ---------- D) generation cap ----------
async function testD() {
  console.log("\n== Plugin D: generation-cap (token bound) ==")
  const hooks = await NightjarGenerationCap({} as any)
  const params = hooks["chat.params"]! as any
  const CAP = Number(process.env.NIGHTJAR_MAX_OUTPUT_TOKENS || 2048)

  // undefined -> capped
  const o1: any = { temperature: 0, topP: 1, topK: 0, maxOutputTokens: undefined, options: {} }
  await params({}, o1)
  check(`undefined maxOutputTokens set to cap (${CAP})`, o1.maxOutputTokens === CAP)

  // too high -> lowered to cap
  const o2: any = { temperature: 0, topP: 1, topK: 0, maxOutputTokens: 100000, options: {} }
  await params({}, o2)
  check("oversized maxOutputTokens lowered to cap", o2.maxOutputTokens === CAP)

  // already lower -> left as-is (never raise)
  const o3: any = { temperature: 0, topP: 1, topK: 0, maxOutputTokens: 512, options: {} }
  await params({}, o3)
  check("smaller caller value left untouched", o3.maxOutputTokens === 512)
}

await testA()
await testB()
await testB_perCall()
await testB_patch()
await testB_subdir()
await testB_newSubdir()
await testC()
await testD()
console.log(`\n==== ${pass} passed, ${fail} failed ====`)
process.exit(fail > 0 ? 1 : 0)
