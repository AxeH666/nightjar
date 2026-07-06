#!/usr/bin/env node
// RETIRED (Phase 2b): the hand-rolled VRAM-tier heuristic was replaced by
// llmfit (© 2026 Alex Jones, MIT; vendored from Odysseus services/hwfit) — a
// 924-model DB with quant/context/run-mode/speed fit. This file is now a thin
// shim that delegates to the vendored llmfit CLI, so the old entry point still
// works. See phase2-odysseus/hwfit_vendor/hwfit_cli.py.
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { homedir } from "node:os"

// repo-relative, not a hardcoded machine path (NIGHTJAR_ROOT set by supervisor/setup)
const ROOT = process.env.NIGHTJAR_ROOT || join(homedir(), "nightjar")
const CLI = join(ROOT, "phase2-odysseus/hwfit_vendor/hwfit_cli.py")
try {
  const out = execFileSync("python3", [CLI, ...process.argv.slice(2)], { encoding: "utf8" })
  process.stdout.write(out)
} catch (e) {
  console.error(`[hw-detect] llmfit CLI failed: ${e.message}`)
  process.exit(1)
}
