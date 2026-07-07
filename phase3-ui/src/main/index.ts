// Nightjar — Electron main process.
// Phase 3: window + supervise the local sidecar stack (llama-server, inference
// proxy, `opencode serve`, side-channel). The window shows immediately with a
// health strip; the renderer connects to OpenCode once it reports healthy.
import { app, BrowserWindow, ipcMain, dialog, shell } from "electron"
import { join, resolve, sep, basename, extname } from "path"
import { homedir, tmpdir } from "os"
import { readFile, writeFile, mkdir } from "fs/promises"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { Supervisor, type ServiceStatus } from "./supervisor"
import { nightjarServices, REPO } from "./services"
import * as byok from "./byok"
import { visionStatus, pullVisionModel, type VisionStatus } from "./vision"

const OPENCODE_URL = process.env.NIGHTJAR_OPENCODE_URL || "http://127.0.0.1:4096"
const SIDE_CHANNEL_URL = process.env.NIGHTJAR_WS_URL || "ws://127.0.0.1:8765"

// The env opencode-serve runs with: repo root + the (decrypted) BYOK keys under
// their non-standard NIGHTJAR_BYOK_* names, which opencode.json references via
// {env:...}. Recomputed on every key change so a removed key's var disappears.
// NIGHTJAR_ROOT MUST match services.ts's REPO (module-derived, portable) — do NOT
// re-derive it here with a ~/nightjar default, or this overlay would clobber the
// correct value and break every {env:NIGHTJAR_ROOT} MCP path when the repo isn't
// literally at ~/nightjar.
function opencodeServeEnv(): Record<string, string> {
  return { NIGHTJAR_ROOT: REPO, ...byok.envForOpencode() }
}

// Roots the renderer is allowed to read TTS audio from (Kokoro writes under the
// Nightjar data dir; tmp is allowed for ad-hoc clips). Anything else is rejected.
const AUDIO_ROOTS = [
  process.env.NIGHTJAR_DATA_DIR || join(homedir(), ".nightjar"),
  tmpdir(),
].map((r) => resolve(r) + sep)

// Odysseus's data dir (DB + settings) — must match the image MCP's ODYSSEUS_DATA_DIR
// in opencode.json ({env:HOME}/.nightjar/odysseus).
const ODYSSEUS_DATA_DIR = join(homedir(), ".nightjar", "odysseus")

// Auto-wire the user's OpenAI BYOK key into Odysseus's image endpoint so image
// generation works from the single key entry — no separate seed step. Runs the same
// phase2-odysseus/seed_image_endpoint.py the CLI uses, passing the decrypted key via
// env. Best-effort: a failure never blocks storing the key or the engine restart.
function runImageSeed(extraEnv: Record<string, string>): Promise<void> {
  return new Promise((done) => {
    const py = join(REPO, "phase2-odysseus", "venv", "bin", "python")
    const script = join(REPO, "phase2-odysseus", "seed_image_endpoint.py")
    const child = spawn(py, [script], {
      env: { ...process.env, NIGHTJAR_ROOT: REPO, ODYSSEUS_DATA_DIR, ...extraEnv },
      stdio: "ignore",
    })
    child.on("error", (e) => {
      console.warn("[byok] image-endpoint seed failed:", e)
      done()
    })
    child.on("exit", () => done())
  })
}
// Image generation resolves ONE active image endpoint. We keep exactly one seeded,
// honoring precedence: a direct OpenAI key wins; OpenRouter is the fallback when no
// OpenAI key is present. Distinct endpoint names let us seed one and remove the other
// without collision. dall-e-3 works with any paid OpenAI key (gpt-image-1 needs OpenAI
// org verification); OpenRouter defaults to openai/gpt-image-1 via its Unified Image API.
const IMAGE_OPENAI_NAME = "OpenAI (image)"
const IMAGE_OPENROUTER_NAME = "OpenRouter (image)"
const seedOpenAIImage = (key: string): Promise<void> =>
  runImageSeed({
    NIGHTJAR_IMAGE_API_KEY: key,
    NIGHTJAR_IMAGE_BASE_URL: "https://api.openai.com/v1",
    NIGHTJAR_IMAGE_MODEL: process.env.NIGHTJAR_IMAGE_MODEL || "dall-e-3",
    NIGHTJAR_IMAGE_ENDPOINT_NAME: IMAGE_OPENAI_NAME,
  })
const seedOpenRouterImage = (key: string): Promise<void> =>
  runImageSeed({
    NIGHTJAR_IMAGE_API_KEY: key,
    NIGHTJAR_IMAGE_BASE_URL: "https://openrouter.ai/api/v1",
    NIGHTJAR_IMAGE_MODEL: process.env.NIGHTJAR_IMAGE_OPENROUTER_MODEL || "openai/gpt-image-1",
    NIGHTJAR_IMAGE_ENDPOINT_NAME: IMAGE_OPENROUTER_NAME,
  })
const unseedImage = (name: string): Promise<void> =>
  runImageSeed({ NIGHTJAR_IMAGE_UNSEED: "1", NIGHTJAR_IMAGE_ENDPOINT_NAME: name })

// One reconcile pass: read the current keys and seed/unseed so the single active
// image endpoint matches precedence (OpenAI > OpenRouter). Reads keys at call time.
async function applyImageEndpoint(): Promise<void> {
  const openai = byok.getKey("openai")
  const openrouter = byok.getKey("openrouter")
  if (openai) {
    await seedOpenAIImage(openai)
    await unseedImage(IMAGE_OPENROUTER_NAME)
  } else if (openrouter) {
    await seedOpenRouterImage(openrouter)
    await unseedImage(IMAGE_OPENAI_NAME)
  } else {
    await unseedImage(IMAGE_OPENAI_NAME)
    await unseedImage(IMAGE_OPENROUTER_NAME)
  }
}

// Reconcile the one active image endpoint to the current BYOK keys + precedence.
// Single-flight + coalesced: each pass runs the seed/unseed subprocesses to
// completion before the next starts (they must not interleave), and if any newer
// request lands mid-run we run ONE more pass afterward so the latest key state
// always wins. Without this, a fire-and-forget startup reconcile could finish
// AFTER a newer byok:set/remove and re-apply stale decisions (e.g. tear down the
// OpenAI row and re-seed OpenRouter while an OpenAI key is stored).
let reconcileInFlight: Promise<void> | null = null
let reconcilePending = false
function reconcileImageEndpoint(): Promise<void> {
  if (reconcileInFlight) {
    // A pass is running; its snapshot may predate this call — queue exactly one
    // more pass (which re-reads keys) and share the in-flight chain.
    reconcilePending = true
    return reconcileInFlight
  }
  reconcileInFlight = (async () => {
    do {
      reconcilePending = false
      await applyImageEndpoint()
    } while (reconcilePending) // a request arrived mid-pass → reconcile again with fresh keys
  })().finally(() => {
    reconcileInFlight = null
  })
  return reconcileInFlight
}

let win: BrowserWindow | null = null
let latestStatus: ServiceStatus[] = []

const supervisor = new Supervisor(nightjarServices(), (statuses) => {
  latestStatus = statuses
  win?.webContents.send("nightjar:status", statuses)
})

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    show: false,
    backgroundColor: "#14110D",
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, "../preload/index.js"), sandbox: false },
  })
  win.on("ready-to-show", () => win?.show())
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, "../renderer/index.html"))
}

ipcMain.handle("nightjar:config", () => ({
  opencodeUrl: OPENCODE_URL,
  sideChannelUrl: SIDE_CHANNEL_URL,
}))
ipcMain.handle("nightjar:status", () => latestStatus)

// Read a TTS WAV for the orb to play + analyse. Path-guarded to the audio roots
// and to audio extensions so the renderer can't read arbitrary files.
ipcMain.handle("nightjar:readAudio", async (_e, filePath: string): Promise<ArrayBuffer> => {
  const abs = resolve(String(filePath))
  const okRoot = AUDIO_ROOTS.some((root) => abs.startsWith(root))
  const okExt = /\.(wav|mp3|ogg)$/i.test(abs)
  if (!okRoot || !okExt) throw new Error(`refused to read audio outside allowed roots: ${abs}`)
  const buf = await readFile(abs)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
})
ipcMain.handle("nightjar:restart", async (_e, _name: string) => {
  /* per-service restart hook (future); supervisor already auto-restarts on crash */
})

// ── Chat attachments IPC ──────────────────────────────────────────────────────
// Native file picker + read/save so the composer can attach files (paste/drag/
// browse). Attachments become base64 data URLs (what OpenCode's file parts require);
// images are also saved to disk so the local vision tool (nightjar_analyze_image,
// which takes a path) can reach them. Generated images are read back for inline display.
const ATTACHMENTS_DIR = join(homedir(), ".nightjar", "attachments")
const GENERATED_IMAGES_DIR = join(ODYSSEUS_DATA_DIR, "generated_images")
const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml",
  ".pdf": "application/pdf", ".txt": "text/plain", ".md": "text/markdown",
  ".json": "application/json", ".csv": "text/csv", ".log": "text/plain",
}
const mimeForPath = (p: string): string => MIME_BY_EXT[extname(p).toLowerCase()] || "application/octet-stream"
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024 // 25 MB

// Open the native file dialog; returns absolute paths ([] if cancelled).
ipcMain.handle("nightjar:pickFiles", async (): Promise<string[]> => {
  const opts: Electron.OpenDialogOptions = {
    title: "Attach files",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] },
      { name: "Documents", extensions: ["pdf", "txt", "md", "json", "csv", "log"] },
      { name: "All files", extensions: ["*"] },
    ],
  }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return r.canceled ? [] : r.filePaths
})

// Read a user-picked file (from the dialog) → base64 data URL + metadata. The user
// explicitly chose it, so no root-guard (unlike readAudio); a size cap applies.
ipcMain.handle(
  "nightjar:readAttachment",
  async (_e, filePath: string): Promise<{ name: string; mime: string; dataUrl: string; size: number; path: string }> => {
    const abs = resolve(String(filePath))
    const buf = await readFile(abs)
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`attachment too large (max ${MAX_ATTACHMENT_BYTES} bytes)`)
    const mime = mimeForPath(abs)
    return { name: basename(abs), mime, size: buf.byteLength, path: abs, dataUrl: `data:${mime};base64,${buf.toString("base64")}` }
  },
)

// Save a pasted/dragged attachment's bytes (a base64 data URL) to the attachments
// dir so a disk path exists for the local vision tool. Returns the absolute path.
ipcMain.handle("nightjar:saveAttachment", async (_e, dataUrl: string, name: string): Promise<string> => {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(String(dataUrl))
  if (!m) throw new Error("saveAttachment: expected a base64 data URL")
  const buf = Buffer.from(m[2], "base64")
  if (buf.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("attachment too large")
  await mkdir(ATTACHMENTS_DIR, { recursive: true })
  const ext = extname(String(name)) || "." + ((m[1].split("/")[1] || "bin").replace("jpeg", "jpg"))
  const abs = join(ATTACHMENTS_DIR, `${randomUUID().slice(0, 12)}${ext}`)
  await writeFile(abs, buf, { mode: 0o600 })
  return abs
})

// Read a generated image (by filename) from Odysseus's generated_images dir → data
// URL, so chat can render it inline (the tool returns a web path not served here).
ipcMain.handle("nightjar:readGeneratedImage", async (_e, filename: string): Promise<string | null> => {
  const abs = join(GENERATED_IMAGES_DIR, basename(String(filename))) // basename → no traversal
  try {
    const buf = await readFile(abs)
    return `data:${mimeForPath(abs) || "image/png"};base64,${buf.toString("base64")}`
  } catch {
    return null
  }
})

// ── BYOK (bring-your-own-key) IPC ─────────────────────────────────────────────
// The renderer only ever gets provider catalog + masked status; raw keys stay in
// the main process (encrypted at rest, decrypted only to inject into the engine).
ipcMain.handle("byok:keyStorageMode", () => byok.keyStorageMode())
ipcMain.handle("byok:list", () =>
  byok.listStatus().map((p) => ({ id: p.id, name: p.name, defaultModel: p.defaultModel, keyHint: p.keyHint, hasKey: p.hasKey })),
)
ipcMain.handle("byok:set", async (_e, providerId: string, key: string) => {
  byok.setKey(providerId, key) // throws (→ rejects to renderer) if no OS keychain
  // OpenAI/OpenRouter also power image generation — auto-wire the Odysseus image
  // endpoint from the stored key(s) so the user never runs a separate seed step
  // (single-key setup). Reconcile honors precedence: OpenAI wins, OpenRouter falls back.
  if (providerId === "openai" || providerId === "openrouter") await reconcileImageEndpoint()
  await supervisor.restartService("opencode-serve", opencodeServeEnv())
})
ipcMain.handle("byok:remove", async (_e, providerId: string) => {
  byok.removeKey(providerId)
  // Re-reconcile: removing OpenAI falls back to OpenRouter (if present); removing
  // OpenRouter tears down its image endpoint (unless OpenAI still owns it).
  if (providerId === "openai" || providerId === "openrouter") await reconcileImageEndpoint()
  await supervisor.restartService("opencode-serve", opencodeServeEnv())
})

// ── Local vision (Ollama gemma3:4b) — status + auto-pull ──────────────────────
// nightjar_analyze_image routes to Ollama's vision model (NIGHTJAR_VISION_MODEL @
// OLLAMA_HOST). Detect readiness, auto-pull the model if Ollama is running but the
// model is missing, and surface status to the renderer. Cloud vision (BYOK) stays
// available as the alternative; this is the offline default.
// `model: "unknown"` (not "absent") is the honest pre-probe state: we haven't
// checked Ollama yet, so the banner must not assert "Install Ollama". The status
// IPC live-probes on demand so a slow supervisor start can't leave the renderer
// staring at a stale default for the whole boot window.
let visionState: VisionStatus = { ollama: "installed", model: "unknown", detail: "checking local vision…" }
function pushVision(s: VisionStatus): void {
  visionState = s
  win?.webContents.send("nightjar:visionStatus", s)
}
// Single-flight guard: startup auto-pull, a "Download gemma3:4b" click, and a
// double-click can all land here at once. Without this, each would re-probe and
// kick off an overlapping pullVisionModel(), resetting the UI from "pulling" back
// to "missing" and firing concurrent /api/pull streams. Concurrent callers share
// the one in-flight run; `pulling` lets the status IPC avoid clobbering its UI.
let visionInFlight: Promise<void> | null = null
let visionPulling = false
function ensureVision(autoPull = process.env.NIGHTJAR_VISION_AUTOPULL !== "0"): Promise<void> {
  if (visionInFlight) return visionInFlight
  visionInFlight = (async () => {
    pushVision(await visionStatus())
    if (visionState.ollama === "running" && visionState.model === "missing" && autoPull) {
      visionPulling = true
      pushVision({ ollama: "running", model: "pulling", pct: 0, detail: "starting download…" })
      const ok = await pullVisionModel((pct, status) => pushVision({ ollama: "running", model: "pulling", pct, detail: status }))
      pushVision(await visionStatus())
      console.log("[vision] gemma3:4b pull", ok ? "complete" : "failed/aborted")
    }
  })().finally(() => {
    visionInFlight = null
    visionPulling = false
  })
  return visionInFlight
}
// Live-probe when idle so the banner is accurate from first paint; while a pull is
// streaming, return the cached "pulling" state instead of stomping it with "missing".
ipcMain.handle("nightjar:visionStatus", async () => {
  if (!visionPulling && !visionInFlight) {
    const s = await visionStatus()
    if (!visionPulling && !visionInFlight) pushVision(s) // re-check: a pull may have begun during the probe
  }
  return visionState
})
ipcMain.handle("nightjar:visionInstallModel", async () => {
  await ensureVision(true)
  return visionState
})
ipcMain.handle("nightjar:openOllamaDownload", () => shell.openExternal("https://ollama.com/download"))

app.whenReady().then(() => {
  createWindow()
  // Inject any stored BYOK keys into opencode-serve's env before it starts.
  supervisor.setEnv("opencode-serve", opencodeServeEnv())
  // Wire the image endpoint from whichever stored key is present (OpenAI wins,
  // OpenRouter falls back), so keys entered before this feature — or on a fresh
  // launch — just work. Fire-and-forget: never blocks the window/stack coming up.
  reconcileImageEndpoint().catch((e) => console.warn("[byok] image endpoint reconcile:", e))
  // fire-and-forget: bring up the stack; the health strip reflects progress. Once
  // the stack (incl. the ollama service) is up, ensure the local vision model.
  if (process.env.NIGHTJAR_NO_SUPERVISOR !== "1") {
    supervisor
      .start()
      .then(() => ensureVision())
      .catch((e) => console.error("supervisor:", e))
  } else {
    ensureVision().catch(() => {})
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let quitting = false
app.on("before-quit", async (e) => {
  if (quitting) return
  e.preventDefault()
  quitting = true
  await supervisor.stop().catch(() => {})
  app.quit()
})
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
