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

const HWFIT_CLI = "/home/axehe/nightjar/phase2-odysseus/hwfit_vendor/hwfit_cli.py"

export const NightjarHwCheck: Plugin = async ({ $ }) => {
  try {
    const raw = await $`python3 ${HWFIT_CLI} --json --limit 3`.quiet().text()
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
  }
  return {}
}
