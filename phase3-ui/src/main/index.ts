// Nightjar — Electron main process.
// Phase 3: window + supervise the local sidecar stack (llama-server, inference
// proxy, `opencode serve`, side-channel). The window shows immediately with a
// health strip; the renderer connects to OpenCode once it reports healthy.
import { app, BrowserWindow, ipcMain } from "electron"
import { join, resolve, sep } from "path"
import { homedir, tmpdir } from "os"
import { readFile } from "fs/promises"
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

// ── BYOK (bring-your-own-key) IPC ─────────────────────────────────────────────
// The renderer only ever gets provider catalog + masked status; raw keys stay in
// the main process (encrypted at rest, decrypted only to inject into the engine).
ipcMain.handle("byok:keyStorageMode", () => byok.keyStorageMode())
ipcMain.handle("byok:list", () =>
  byok.listStatus().map((p) => ({ id: p.id, name: p.name, defaultModel: p.defaultModel, keyHint: p.keyHint, hasKey: p.hasKey })),
)
ipcMain.handle("byok:set", async (_e, providerId: string, key: string) => {
  byok.setKey(providerId, key) // throws (→ rejects to renderer) if no OS keychain
  await supervisor.restartService("opencode-serve", opencodeServeEnv())
})
ipcMain.handle("byok:remove", async (_e, providerId: string) => {
  byok.removeKey(providerId)
  await supervisor.restartService("opencode-serve", opencodeServeEnv())
})

app.whenReady().then(() => {
  createWindow()
  // Inject any stored BYOK keys into opencode-serve's env before it starts.
  supervisor.setEnv("opencode-serve", opencodeServeEnv())
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
