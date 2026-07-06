// Tests for the local-vision detect/pull core. Runs REAL checks against this box's
// Ollama (which has gemma3:4b) plus synthetic unit cases. Run: bun test-vision.ts
import { findOllama, ollamaUp, hasVisionModel, visionStatus, modelInList, VISION_MODEL, OLLAMA_HOST } from "./src/main/vision"
import { nightjarServices } from "./src/main/services"

let pass = 0,
  fail = 0
const check = (n: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${n}${extra ? " — " + extra : ""}`)
  ok ? pass++ : fail++
}

// --- unit: modelInList matching ---
check("modelInList exact tag", modelInList(["gemma3:4b", "qwen3:8b"], "gemma3:4b"))
check("modelInList :latest variant", modelInList(["gemma3:4b:latest"], "gemma3:4b"))
check("modelInList -suffix variant", modelInList(["gemma3:4b-instruct-q4"], "gemma3:4b"))
check("modelInList rejects different tag", !modelInList(["gemma3:1b", "gemma3:12b"], "gemma3:4b"))
check("modelInList rejects empty", !modelInList([], "gemma3:4b"))

// --- integration: the real Ollama on this box ---
const bin = findOllama()
check("findOllama locates the binary", !!bin, String(bin))
check("ollamaUp true (daemon running)", await ollamaUp())
check("hasVisionModel(gemma3:4b) true (already pulled)", await hasVisionModel(VISION_MODEL, OLLAMA_HOST))
check("hasVisionModel(bogus) false", !(await hasVisionModel("no-such-model:999b")))

const st = await visionStatus()
check("visionStatus → running + present", st.ollama === "running" && st.model === "present", JSON.stringify(st))

// --- integration: daemon-down path (point at a dead port) ---
const down = await visionStatus(VISION_MODEL, "http://127.0.0.1:1")
check(
  "daemon-down → ollama 'installed' (binary present), model 'unknown'",
  down.ollama === "installed" && down.model === "unknown",
  JSON.stringify(down),
)

// --- config consistency + service wiring ---
check("VISION_MODEL defaults to gemma3:4b (matches the Python vision config)", VISION_MODEL === "gemma3:4b")
const ollamaSvc = nightjarServices().find((s) => s.name === "ollama")
check(
  "nightjarServices() includes the ollama service (installed on this box)",
  !!ollamaSvc && ollamaSvc.command.endsWith("ollama") && ollamaSvc.args[0] === "serve",
  ollamaSvc ? `${ollamaSvc.command} ${ollamaSvc.args.join(" ")}` : "absent",
)

console.log(`\n==== local-vision core: ${pass} passed, ${fail} failed ====`)
process.exit(fail > 0 ? 1 : 0)
