// Nightjar sidecar service definitions — the local stack the supervisor manages.
// Paths are absolute (Electron main won't inherit a dev PATH) and overridable via env.
import net from "node:net"
import os from "node:os"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { ServiceDef } from "./supervisor"
import { httpOk } from "./supervisor"
import { findOllama, OLLAMA_HOST } from "./vision"

const HOME = os.homedir()
const BUN = process.env.NIGHTJAR_BUN || join(HOME, ".bun/bin/bun")
// Repo root: an explicit NIGHTJAR_ROOT wins; otherwise DERIVE it from this
// module's own location rather than assuming ~/nightjar (which breaks when the
// project is cloned anywhere else). This file sits at <repo>/phase3-ui/src/main/
// under bun and <repo>/phase3-ui/out/main/ in the Electron build — both are three
// levels below the repo root, so the same "../../.." resolves correctly in either.
export const REPO = process.env.NIGHTJAR_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const OPENCODE_ENTRY = join(REPO, "research/opencode/packages/opencode/src/index.ts")
const LLAMA_BIN = process.env.NIGHTJAR_LLAMA_BIN || join(HOME, "llama.cpp/build-cuda/bin/llama-server")
const MODEL = process.env.NIGHTJAR_MODEL_GGUF || join(HOME, "models/qwen3-4b-instruct-2507/Qwen3-4B-Instruct-2507-Q4_K_M.gguf")
// Local IMAGE generation (NJ-6): the diffusers GPU venv + the Z-Image-Turbo model dir.
const DIFFUSION_PY = process.env.NIGHTJAR_DIFFUSION_PY || join(REPO, "diffusion-mcp/venv/bin/python")
const DIFFUSION_PORT = process.env.NIGHTJAR_DIFFUSION_PORT || "8100"

// The local image-model directory (Z-Image-Turbo), present only if it exists AND
// holds a model_index.json (a real diffusers checkpoint). Returns null otherwise, so
// the diffusion sidecar + the local-first image endpoint are wired ONLY when there is
// actually a model to serve. Mirrors findOllama()'s "add only if installed" gate.
export function findImageModel(): string | null {
  const dir = process.env.NIGHTJAR_IMAGE_MODEL_DIR || join(HOME, "models/Z-Image-Turbo")
  return existsSync(join(dir, "model_index.json")) ? dir : null
}
// Exported so the preview/artifact layer can compute tidy relative mirror paths
// (relative(WORKSPACE, filePath)) for files the coding agent writes.
export const WORKSPACE = process.env.NIGHTJAR_WORKSPACE || join(REPO, "phase2-odysseus/workspace")

function tcpOpen(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket()
    const done = (ok: boolean) => {
      sock.destroy()
      resolve(ok)
    }
    sock.setTimeout(timeoutMs)
    sock.once("connect", () => done(true))
    sock.once("timeout", () => done(false))
    sock.once("error", () => done(false))
    sock.connect(port, host)
  })
}

export function nightjarServices(): ServiceDef[] {
  const ollamaBin = findOllama()
  // NJ-8: opt-in "design profile" (NIGHTJAR_DESIGN_PROFILE=1) lifts the local
  // model's output caps so a bigger single previewable artifact fits in one write.
  // OFF by default — when off, every value below equals the prior hardcoded one, so
  // behavior is unchanged (rule 3: never the global default). When on, the predict
  // AND context caps AND the matching wall-clock timeouts all rise TOGETHER (a raised
  // predict alone would just hit the old timeout), and each stays FINITE. The
  // opencode-serve generation-cap plugin reads NIGHTJAR_MAX_OUTPUT_TOKENS, so it is
  // lifted in lockstep below — otherwise it would re-clamp output back to 2048.
  const DESIGN = /^(1|true|on)$/i.test(process.env.NIGHTJAR_DESIGN_PROFILE || "")
  const PREDICT = DESIGN ? 6144 : 2048
  const LCTX = DESIGN ? 16384 : 8192
  const LLAMA_TIMEOUT = DESIGN ? 300 : 120
  const PROXY_TIMEOUT_MS = DESIGN ? 300000 : 90000
  const services: ServiceDef[] = [
    {
      name: "llama-server",
      command: LLAMA_BIN,
      args: [
        "-m", MODEL, "--alias", "qwen3-4b-instruct-2507",
        "--jinja", "-c", String(LCTX), "--cache-type-k", "q8_0", "-ngl", "99",
        "--predict", String(PREDICT), "--timeout", String(LLAMA_TIMEOUT),
        "--host", "127.0.0.1", "--port", "8085",
      ],
      ready: () => httpOk("http://127.0.0.1:8085/health", (b) => b.includes("ok")),
      readyTimeoutMs: 120000, // cold model load can take a while
    },
    {
      name: "inference-proxy",
      command: BUN,
      args: [join(REPO, "phase1-engine/inference-proxy.mjs")],
      env: { NIGHTJAR_UPSTREAM: "http://127.0.0.1:8085", NIGHTJAR_PROXY_PORT: "8086", NIGHTJAR_INFERENCE_TIMEOUT_MS: String(PROXY_TIMEOUT_MS) },
      ready: () => httpOk("http://127.0.0.1:8086/health"),
      readyTimeoutMs: 15000,
    },
    {
      name: "opencode-serve",
      command: BUN,
      args: ["run", "--conditions=browser", OPENCODE_ENTRY, "serve", "--port", "4096", "--hostname", "127.0.0.1"],
      cwd: WORKSPACE,
      port: 4096, // NJ-5: lets the supervisor capture the PID if this engine is ADOPTED (already on :4096)
      // opencode.json uses {env:NIGHTJAR_ROOT} for repo-relative MCP paths so the
      // config is portable (no hardcoded /home/<user>/...). Pass NIGHTJAR_ROOT
      // through so those substitutions resolve — the app needs no manual setup.
      env: { NIGHTJAR_ROOT: REPO, ...(DESIGN ? { NIGHTJAR_MAX_OUTPUT_TOKENS: "6144" } : {}) },
      ready: () => httpOk("http://127.0.0.1:4096/agent"),
      readyTimeoutMs: 60000, // also spawns the MCP servers per opencode.json
    },
    {
      name: "side-channel",
      command: join(REPO, "phase2-mcp/venv/bin/python"),
      args: [join(REPO, "phase2-mcp/sidechannel.py")],
      ready: () => tcpOpen("127.0.0.1", 8765),
      readyTimeoutMs: 15000,
    },
    {
      name: "wake-daemon",
      command: join(REPO, "phase2-mcp/venv/bin/python"),
      args: [join(REPO, "phase2-mcp/wake_daemon.py")],
      cwd: join(REPO, "phase2-mcp"),
      // Best-effort: no mic/audio hardware is not a reason the rest of Nightjar
      // should fail to start, so this is last in dependency order and its
      // failure doesn't block the other services (each service starts/gates
      // independently in nightjarServices() array order).
      ready: () => tcpOpen("127.0.0.1", 8766),
      readyTimeoutMs: 20000,
    },
  ]
  // Ollama hosts the local VISION model (gemma3:4b) for nightjar_analyze_image — add
  // it only if installed. A system daemon already on :11434 is ADOPTED (not double-
  // spawned); otherwise we run `ollama serve`. Placed LAST + best-effort: its absence
  // just means local image analysis is unavailable (cloud vision/BYOK still works),
  // and it never delays the core stack.
  if (ollamaBin) {
    services.push({
      name: "ollama",
      command: ollamaBin,
      args: ["serve"],
      ready: () => httpOk(`${OLLAMA_HOST}/api/tags`),
      readyTimeoutMs: 20000,
    })
  }
  // Local IMAGE generation (Z-Image-Turbo via diffusers) — added ONLY when the model
  // dir + the GPU venv both exist. Placed LAST + best-effort, like ollama: a slow
  // ~6GB GPU load must never block the core stack, and its absence just means image
  // gen falls back to a cloud endpoint (when a BYOK key is set). The supervisor's
  // readyTimeout wall-clock-gates the load (rule 3 at the process level).
  const imageModel = findImageModel()
  if (imageModel && existsSync(DIFFUSION_PY)) {
    services.push({
      name: "diffusion-server",
      command: DIFFUSION_PY,
      args: [
        join(REPO, "research/odysseus/scripts/diffusion_server.py"),
        "--model", imageModel,
        "--host", "127.0.0.1",
        "--port", DIFFUSION_PORT,
        "--dtype", "bfloat16",
      ],
      ready: () => httpOk(`http://127.0.0.1:${DIFFUSION_PORT}/health`, (b) => b.includes("ok")),
      readyTimeoutMs: 180000, // cold ~6GB model load on GPU
    })
  }
  return services
}
