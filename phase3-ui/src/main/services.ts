// Nightjar sidecar service definitions — the local stack the supervisor manages.
// Paths are absolute (Electron main won't inherit a dev PATH) and overridable via env.
import net from "node:net"
import os from "node:os"
import { join } from "node:path"
import type { ServiceDef } from "./supervisor"
import { httpOk } from "./supervisor"

const HOME = os.homedir()
const BUN = process.env.NIGHTJAR_BUN || join(HOME, ".bun/bin/bun")
const REPO = process.env.NIGHTJAR_ROOT || join(HOME, "nightjar")
const OPENCODE_ENTRY = join(REPO, "research/opencode/packages/opencode/src/index.ts")
const LLAMA_BIN = process.env.NIGHTJAR_LLAMA_BIN || join(HOME, "llama.cpp/build-cuda/bin/llama-server")
const MODEL = process.env.NIGHTJAR_MODEL_GGUF || join(HOME, "models/qwen3-4b-instruct-2507/Qwen3-4B-Instruct-2507-Q4_K_M.gguf")
const WORKSPACE = process.env.NIGHTJAR_WORKSPACE || join(REPO, "phase2-odysseus/workspace")

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
  return [
    {
      name: "llama-server",
      command: LLAMA_BIN,
      args: [
        "-m", MODEL, "--alias", "qwen3-4b-instruct-2507",
        "--jinja", "-c", "8192", "--cache-type-k", "q8_0", "-ngl", "99",
        "--predict", "2048", "--timeout", "120",
        "--host", "127.0.0.1", "--port", "8085",
      ],
      ready: () => httpOk("http://127.0.0.1:8085/health", (b) => b.includes("ok")),
      readyTimeoutMs: 120000, // cold model load can take a while
    },
    {
      name: "inference-proxy",
      command: BUN,
      args: [join(REPO, "phase1-engine/inference-proxy.mjs")],
      env: { NIGHTJAR_UPSTREAM: "http://127.0.0.1:8085", NIGHTJAR_PROXY_PORT: "8086", NIGHTJAR_INFERENCE_TIMEOUT_MS: "90000" },
      ready: () => httpOk("http://127.0.0.1:8086/health"),
      readyTimeoutMs: 15000,
    },
    {
      name: "opencode-serve",
      command: BUN,
      args: ["run", "--conditions=browser", OPENCODE_ENTRY, "serve", "--port", "4096", "--hostname", "127.0.0.1"],
      cwd: WORKSPACE,
      // opencode.json uses {env:NIGHTJAR_ROOT} for repo-relative MCP paths so the
      // config is portable (no hardcoded /home/<user>/...). Pass NIGHTJAR_ROOT
      // through so those substitutions resolve — the app needs no manual setup.
      env: { NIGHTJAR_ROOT: REPO },
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
}
