// Nightjar — Electron main process.
// Phase 3: window + supervise the local sidecar stack (llama-server, inference
// proxy, `opencode serve`, side-channel). The window shows immediately with a
// health strip; the renderer connects to OpenCode once it reports healthy.
import { app, BrowserWindow, ipcMain, dialog } from "electron"
import { join, resolve, sep, basename, extname } from "path"
import { homedir, tmpdir } from "os"
import { readFile, writeFile, mkdir } from "fs/promises"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { Supervisor, type ServiceStatus } from "./supervisor"
import { nightjarServices, REPO } from "./services"
import * as byok from "./byok"

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
// dall-e-3 works with any paid key (gpt-image-1 needs OpenAI org verification).
const seedImageEndpoint = (key: string): Promise<void> =>
  runImageSeed({ OPENAI_API_KEY: key, NIGHTJAR_IMAGE_MODEL: process.env.NIGHTJAR_IMAGE_MODEL || "dall-e-3" })
const unseedImageEndpoint = (): Promise<void> => runImageSeed({ NIGHTJAR_IMAGE_UNSEED: "1" })

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
  // OpenAI also powers image generation — auto-wire the Odysseus image endpoint from
  // the same key so the user never runs a separate seed step (single-key setup).
  if (providerId === "openai") await seedImageEndpoint(key)
  await supervisor.restartService("opencode-serve", opencodeServeEnv())
})
ipcMain.handle("byok:remove", async (_e, providerId: string) => {
  byok.removeKey(providerId)
  if (providerId === "openai") await unseedImageEndpoint()
  await supervisor.restartService("opencode-serve", opencodeServeEnv())
})

app.whenReady().then(() => {
  createWindow()
  // Inject any stored BYOK keys into opencode-serve's env before it starts.
  supervisor.setEnv("opencode-serve", opencodeServeEnv())
  // If an OpenAI key is already stored, wire the image endpoint at startup too
  // (so keys entered before this feature — or on a fresh launch — just work).
  const storedOpenAI = byok.getKey("openai")
  if (storedOpenAI) seedImageEndpoint(storedOpenAI)
  // fire-and-forget: bring up the stack; the health strip reflects progress
  if (process.env.NIGHTJAR_NO_SUPERVISOR !== "1") supervisor.start().catch((e) => console.error("supervisor:", e))
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
