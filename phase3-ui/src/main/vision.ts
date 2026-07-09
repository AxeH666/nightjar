// Nightjar local vision (offline image analysis). The `nightjar_analyze_image` MCP
// tool routes to Ollama's `NIGHTJAR_VISION_MODEL` (default gemma3:4b) at OLLAMA_HOST.
// This module detects Ollama + the model and pulls the model if missing, so offline
// image analysis works by default — cloud vision (BYOK) remains the alternative.
// The Ollama daemon itself is run as a supervised service (see services.ts).
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const OLLAMA_HOST = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/+$/, "")
export const VISION_MODEL = process.env.NIGHTJAR_VISION_MODEL || "gemma3:4b"

export interface VisionStatus {
  // daemon reachable / binary present but daemon down / not installed
  ollama: "running" | "installed" | "absent"
  model: "present" | "missing" | "pulling" | "unknown"
  pct?: number
  detail?: string
}

const OLLAMA_CANDIDATES = [
  "/usr/local/bin/ollama",
  "/usr/bin/ollama",
  "/opt/homebrew/bin/ollama",
  join(homedir(), ".local/bin/ollama"),
  join(homedir(), "AppData/Local/Programs/Ollama/ollama.exe"),
]

// Absolute path to the ollama binary, or null if not installed.
export function findOllama(): string | null {
  for (const c of OLLAMA_CANDIDATES) if (existsSync(c)) return c
  try {
    const which = process.platform === "win32" ? "where" : "which"
    const r = spawnSync(which, ["ollama"], { encoding: "utf8" })
    const p = (r.stdout || "").split(/\r?\n/)[0].trim()
    if (p && existsSync(p)) return p
  } catch {
    /* ignore */
  }
  return null
}

// GET /api/tags → model-name list, or null if the daemon isn't reachable.
async function tags(host = OLLAMA_HOST, timeoutMs = 3000): Promise<string[] | null> {
  try {
    const r = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) return null
    const d = (await r.json()) as { models?: Array<{ name?: string; model?: string }> }
    return (d.models ?? []).map((m) => m.name || m.model || "").filter(Boolean)
  } catch {
    return null
  }
}

export async function ollamaUp(host = OLLAMA_HOST): Promise<boolean> {
  return (await tags(host)) !== null
}

// Is `model` in the tag list? Matches the exact tag, `:latest`, or a `-`-suffixed variant.
export function modelInList(names: string[], model = VISION_MODEL): boolean {
  return names.some((n) => n === model || n === `${model}:latest` || n.startsWith(`${model}-`))
}

export async function hasVisionModel(model = VISION_MODEL, host = OLLAMA_HOST): Promise<boolean> {
  const names = await tags(host)
  return names !== null && modelInList(names, model)
}

// Snapshot the current local-vision readiness.
export async function visionStatus(model = VISION_MODEL, host = OLLAMA_HOST): Promise<VisionStatus> {
  const names = await tags(host)
  if (names === null) {
    const bin = findOllama()
    return {
      ollama: bin ? "installed" : "absent",
      model: "unknown",
      detail: bin ? "Ollama installed but its daemon isn't reachable" : "Ollama is not installed",
    }
  }
  return { ollama: "running", model: modelInList(names, model) ? "present" : "missing" }
}

// Pull the vision model, streaming NDJSON progress from POST /api/pull. Resolves true
// only if the pull finished AND the model is now present.
export async function pullVisionModel(
  onProgress?: (pct: number, status: string) => void,
  model = VISION_MODEL,
  host = OLLAMA_HOST,
): Promise<boolean> {
  // rule 3: a multi-GB pull is legitimately long, so a fixed wall-clock cap is
  // wrong — but a STALLED stream (Ollama wedged, socket open, bytes stop) must not
  // hang forever. Guard with an idle timeout reset on every received chunk: no
  // progress for PULL_IDLE_MS → abort the read so the caller returns false instead
  // of blocking the vision subsystem indefinitely.
  const PULL_IDLE_MS = 60000
  const ac = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => ac.abort(), PULL_IDLE_MS)
  }
  try {
    const r = await fetch(`${host}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
      signal: ac.signal,
    })
    if (!r.ok || !r.body) return false
    const reader = r.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    let sawError = false
    resetIdle()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      resetIdle()
      buf += dec.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (!line) continue
        try {
          const j = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string }
          if (j.error) {
            sawError = true
            onProgress?.(0, `error: ${j.error}`)
            continue
          }
          const pct = j.total ? Math.round(((j.completed ?? 0) / j.total) * 100) : undefined
          onProgress?.(pct ?? 0, j.status ?? "")
        } catch {
          /* non-JSON keep-alive line */
        }
      }
    }
    return !sawError && (await hasVisionModel(model, host))
  } catch {
    return false
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
  }
}
