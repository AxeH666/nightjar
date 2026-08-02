#!/usr/bin/env node
// Guard: every `plugin` entry in the engine workspace config must resolve to a
// file that actually exists.
//
// Why this exists (found while moving the workspace out of phase2-odysseus/):
// OpenCode resolves path-like plugin specs relative to the DIRECTORY OF THE
// CONFIG FILE (packages/opencode/src/config/plugin.ts — `path.resolve(
// path.dirname(configFilepath), spec)`), and a spec that resolves to a
// missing file is skipped **silently**. Verified by deliberately breaking one
// path: the engine still booted, /agent still answered, and the other plugins
// still loaded — with no error on stdout, stderr, or the HTTP surface.
//
// Five of the six plugins are the Nightjar SAFETY harness (no-destructive-write,
// generation-cap, doom-loop, git-gate). A typo in a relative path would disable
// one of them with no signal at all — the failure mode CLAUDE.md rules 1 and 6
// exist to prevent. So assert the paths statically instead of trusting a boot.
//
// Run:  node phase1-engine/tests/test_plugin_paths.mjs

import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = process.env.NIGHTJAR_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const CONFIG = join(ROOT, "engine-workspace/opencode.json")

// The config is JSONC (it carries // comments), so strip them before parsing.
// Deliberately conservative: only strips whole-line // comments, which is the
// only comment style the file uses.
function parseJsonc(text) {
  return JSON.parse(
    text
      .split("\n")
      .filter((l) => !/^\s*\/\//.test(l))
      .join("\n"),
  )
}

let failures = 0
const check = (ok, label, detail = "") => {
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) failures++
}

console.log(`== engine workspace config ==\n  ${CONFIG}\n`)
check(existsSync(CONFIG), "opencode.json exists at the expected location")
if (!existsSync(CONFIG)) process.exit(1)

const cfg = parseJsonc(readFileSync(CONFIG, "utf8"))
const plugins = cfg.plugin ?? []

console.log(`\n== ${plugins.length} plugin path(s) resolve to real files ==`)
check(plugins.length === 6, "expected 6 plugins", `found ${plugins.length}`)

const base = dirname(CONFIG) // OpenCode resolves relative to the CONFIG's dir
for (const spec of plugins) {
  const p = typeof spec === "string" ? spec : spec[0]
  const abs = resolve(base, p)
  check(existsSync(abs), p, existsSync(abs) ? "" : `missing → ${abs}`)
}

// The safety plugins specifically — named so a silent drop is obvious in CI output.
console.log("\n== the safety harness is wired ==")
for (const name of [
  "nightjar-no-destructive-write",
  "nightjar-generation-cap",
  "nightjar-doom-loop",
  "nightjar-git-gate",
]) {
  const hit = plugins.some((s) => (typeof s === "string" ? s : s[0]).includes(name))
  check(hit, `${name} is listed`)
}

console.log(failures ? `\nFAILED (${failures})` : "\nALL CHECKS PASSED")
process.exit(failures ? 1 : 0)
