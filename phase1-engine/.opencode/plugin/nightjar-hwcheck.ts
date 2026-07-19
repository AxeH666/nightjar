// Nightjar startup hardware check (detection + logging only).
// The plugin function body runs once when OpenCode loads plugins at startup and
// logs a hardware summary + which local models FIT this machine.
//
// PHASE 2b: now backed by llmfit (© 2026 Alex Jones, MIT; vendored from Odysseus
// services/hwfit) instead of the retired hand-rolled hw-detect.mjs tier list.
// llmfit is pure-stdlib Python (no venv/deps), so we shell out to the vendored
// CLI. Same integration point (a startup log line); richer output (924-model DB,
// quant/context/run-mode/speed fit). Detection + logging only; no auto-switch yet.

import type { Plugin } from "@opencode-ai/plugin"
import { join } from "node:path"
import { homedir } from "node:os"

// repo-relative, not a hardcoded machine path (NIGHTJAR_ROOT set by supervisor/setup)
const ROOT = process.env.NIGHTJAR_ROOT || join(homedir(), "nightjar")
const HWFIT_CLI = join(ROOT, "phase2-odysseus/hwfit_vendor/hwfit_cli.py")

export const NightjarHwCheck: Plugin = async ({ $ }) => {
  // hwfit_cli is pure-stdlib Python (no venv), so any interpreter works — but `python3` is not on
  // the default Windows PATH (it's `py`/`python` there), so this silently failed on Windows
  // (audit1.md P2-10). Resolve OS-aware. Detection-only + best-effort, and it runs during plugin
  // init, so also bound it with a short timeout: a hung/absent interpreter must not delay
  // opencode-serve startup (rule 3).
  const isWin = process.platform === "win32"
  const TIMEOUT_MS = Number(process.env.NIGHTJAR_HWCHECK_TIMEOUT_MS || 8000)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const run = isWin
      ? $`py -3 ${HWFIT_CLI} --json --limit 3`.quiet().text()
      : $`python3 ${HWFIT_CLI} --json --limit 3`.quiet().text()
    const raw = await Promise.race([
      run,
      new Promise<string>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`hwcheck timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
      }),
    ])
    const data = JSON.parse(raw)
    const sys = data.system ?? {}
    const gpus = (sys.gpus ?? []).map((g: any) => `${g.name} ${g.vram_gb}GB`).join(", ") || "none"
    const top = (data.top ?? [])
      .map((m: any) => `${m.name}[${m.quant} ctx${m.context} ${m.run_mode} ~${m.speed_tps}tps]`)
      .join(" | ")
    console.error(
      `[nightjar-hwcheck] (llmfit) GPU=${gpus} RAM=${sys.ram_gb ?? "?"}GB backend=${sys.backend ?? "?"} ` +
        `-> best fits: ${top || "(none)"} (detection only; auto-switch not wired yet)`,
    )
  } catch (e) {
    console.error(`[nightjar-hwcheck] llmfit hardware detection failed: ${e}`)
  } finally {
    // Clear the armed timeout when the subprocess won the race — otherwise it fires later and
    // rejects a promise nobody awaits (an unhandled rejection). Bounded caller only: if the
    // timeout won, the short llmfit script is left to finish on its own (startup is unblocked).
    if (timer !== undefined) clearTimeout(timer)
  }
  return {}
}
