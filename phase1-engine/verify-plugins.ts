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
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs"
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

// ---------- C) doom-loop ----------
async function testC() {
  console.log("\n== Plugin C: doom-loop ==")
  const hooks = await NightjarDoomLoop({} as any)
  const before = hooks["tool.execute.before"]!
  const permAsk = hooks["permission.ask"]! as any

  const call = () => before({ tool: "grep", sessionID: "s", callID: "x" }, { args: { pattern: "foo" } })
  check("1st identical call allowed", !(await throws(call)))
  check("2nd identical call allowed", !(await throws(call)))
  check("3rd identical call BLOCKED", await throws(call))
  // different args resets independently
  check(
    "different args still allowed",
    !(await throws(() => before({ tool: "grep", sessionID: "s", callID: "y" }, { args: { pattern: "bar" } }))),
  )
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
await testC()
await testD()
console.log(`\n==== ${pass} passed, ${fail} failed ====`)
process.exit(fail > 0 ? 1 : 0)
