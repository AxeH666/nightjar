// Nightjar — Electron main process.
// Phase 3: window + supervise the local sidecar stack (llama-server, inference
// proxy, `opencode serve`, side-channel). The window shows immediately with a
// health strip; the renderer connects to OpenCode once it reports healthy.
import { app, BrowserWindow, ipcMain, dialog, shell } from "electron"
import { join, resolve, sep, basename, extname, dirname } from "path"
import { homedir, tmpdir } from "os"
import { readFile, writeFile, mkdir } from "fs/promises"
import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { Supervisor, type ServiceStatus } from "./supervisor"
import { nightjarServices, REPO, REPO_POSIX, HOME_POSIX, WORKSPACE, findImageModel, isWSL, VENV_PY, venvPython } from "./services"
import * as byok from "./byok"
import * as capabilities from "./capabilities"
import { resolveImageBackend, type ImageBackend } from "./image-endpoint"
import { visionStatus, pullVisionModel, type VisionStatus } from "./vision"
import { convertStepToGlb, readGlb, buildHeroModel } from "./cad"
import { startLocalScheduler, stopLocalScheduler } from "./scheduler"
import * as preview from "./preview-server"

const OPENCODE_URL = process.env.NIGHTJAR_OPENCODE_URL || "http://127.0.0.1:4096"
const SIDE_CHANNEL_URL = process.env.NIGHTJAR_WS_URL || "ws://127.0.0.1:8765"

// WSLg has no working GPU: the GPU process fails to initialise ("Exiting GPU process due
// to errors during initialization") and Chromium's software-WebGL fallback is gated behind
// a flag. Left as-is this spams GL errors and can take the renderer/window down (a dead
// window reads as "the app stopped responding"). Under WSL, skip the GPU process entirely
// and enable SwiftShader so rendering is stable in software AND the CAD three.js viewer
// still draws. Native Windows/macOS/Linux keep their real GPU (these calls must run before
// app 'ready', i.e. here at module load). See NJ-30.
if (isWSL()) {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch("enable-unsafe-swiftshader")
}

// The env opencode-serve runs with: repo root + the (decrypted) BYOK keys under
// their non-standard NIGHTJAR_BYOK_* names, which opencode.json references via
// {env:...}. Recomputed on every key change so a removed key's var disappears.
// NIGHTJAR_ROOT/HOME MUST match services.ts's slash-normalized REPO_POSIX/HOME_POSIX
// (module-derived, portable) — do NOT re-derive them here with a ~/nightjar default, or this
// overlay would clobber the correct value and break every {env:NIGHTJAR_ROOT} MCP path when the
// repo isn't literally at ~/nightjar. They are forward-slashed so the values OpenCode splices
// into opencode.json's string values parse as valid JSON on native Windows (NJ-34).
function opencodeServeEnv(): Record<string, string> {
  // NJ_VENV_PY is REQUIRED here (not just in the service def): setEnv() overrides the def env
  // with this at startup, and every restart rebuilds from it — without it the opencode.json MCP
  // commands' {env:NJ_VENV_PY} resolves to "" and every MCP fails (on Linux too). NIGHTJAR_ROOT +
  // HOME are slash-normalized (NJ-34); a backslash HOME/ROOT would break config parsing on Windows.
  return { NIGHTJAR_ROOT: REPO_POSIX, NJ_VENV_PY: VENV_PY, HOME: HOME_POSIX, ...byok.envForOpencode(), ...capabilities.envForOpencode() }
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
// Resolves TRUE only on a clean (exit-0) seed/unseed; false on spawn error or a non-zero
// exit. applyImageEndpoint logs a false result (a failed seed/unseed leaves the DB in a
// transient state the NEXT reconcile — key change, diffusion health, capability change,
// or startup — heals). NOTE: under explicit selection we do NOT keep a non-chosen backend
// alive on a failed seed (the old rationale): retiring the unchosen rows is a PRIVACY
// guarantee (Offline must never keep a cloud row), so a failed seed yields "no backend"
// rather than a silent fallback — the honest, safe outcome.
function runImageSeed(extraEnv: Record<string, string>): Promise<boolean> {
  return new Promise((done) => {
    const py = venvPython(join(REPO, "phase2-odysseus", "venv"))
    const script = join(REPO, "phase2-odysseus", "seed_image_endpoint.py")
    const child = spawn(py, [script], {
      env: { ...process.env, NIGHTJAR_ROOT: REPO, ODYSSEUS_DATA_DIR, ...extraEnv },
      stdio: "ignore",
    })
    child.on("error", (e) => {
      console.warn("[byok] image-endpoint seed failed:", e)
      done(false)
    })
    child.on("exit", (code) => done(code === 0))
  })
}
// Image generation resolves ONE active image endpoint. We keep exactly one seeded —
// the one the user EXPLICITLY chose for the image capability (Offline local, or a
// specific Online provider); see applyImageEndpoint. Distinct endpoint names let us
// seed one and remove the others without collision. dall-e-3 works with any paid
// OpenAI key (gpt-image-1 needs OpenAI org verification); OpenRouter defaults to
// openai/gpt-image-1 via its Unified Image API.
const IMAGE_OPENAI_NAME = "OpenAI (image)"
const IMAGE_OPENROUTER_NAME = "OpenRouter (image)"
const seedOpenAIImage = (key: string): Promise<boolean> =>
  runImageSeed({
    NIGHTJAR_IMAGE_API_KEY: key,
    NIGHTJAR_IMAGE_BASE_URL: "https://api.openai.com/v1",
    NIGHTJAR_IMAGE_MODEL: process.env.NIGHTJAR_IMAGE_MODEL || "dall-e-3",
    NIGHTJAR_IMAGE_ENDPOINT_NAME: IMAGE_OPENAI_NAME,
  })
const seedOpenRouterImage = (key: string): Promise<boolean> =>
  runImageSeed({
    NIGHTJAR_IMAGE_API_KEY: key,
    NIGHTJAR_IMAGE_BASE_URL: "https://openrouter.ai/api/v1",
    NIGHTJAR_IMAGE_MODEL: process.env.NIGHTJAR_IMAGE_OPENROUTER_MODEL || "openai/gpt-image-1",
    NIGHTJAR_IMAGE_ENDPOINT_NAME: IMAGE_OPENROUTER_NAME,
  })
const unseedImage = (name: string): Promise<boolean> =>
  runImageSeed({ NIGHTJAR_IMAGE_UNSEED: "1", NIGHTJAR_IMAGE_ENDPOINT_NAME: name })

// Offline image gen (NJ-6): an endpoint pointing at the local diffusion sidecar,
// activated when the image capability is set to Offline. modelId = basename of the
// model dir so it matches the server's own _model_id.
const IMAGE_LOCAL_NAME = "Local (image)"
const DIFFUSION_PORT = process.env.NIGHTJAR_DIFFUSION_PORT || "8100"
const seedLocalImage = (modelId: string): Promise<boolean> =>
  runImageSeed({
    NIGHTJAR_IMAGE_API_KEY: "",
    NIGHTJAR_IMAGE_BASE_URL: `http://127.0.0.1:${DIFFUSION_PORT}/v1`,
    NIGHTJAR_IMAGE_MODEL: modelId,
    NIGHTJAR_IMAGE_ENDPOINT_NAME: IMAGE_LOCAL_NAME,
  })
// Is the local diffusion sidecar actually serving? Disk presence alone isn't enough —
// a slow ~6GB GPU load may not be ready yet — so gate local-first on /health, giving
// graceful degradation to a cloud key when the sidecar is down. Short timeout so
// reconcile stays snappy.
async function localImageHealthy(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${DIFFUSION_PORT}/health`, { signal: AbortSignal.timeout(1500) })
    return r.ok && (await r.text()).includes("ok")
  } catch {
    return false
  }
}

// One reconcile pass: seed the single active image endpoint to match the user's
// EXPLICIT image-capability choice (PR3 — replaces the old implicit local-first +
// OpenAI>OpenRouter precedence). Offline → the local diffusion sidecar (only when
// serving); Online → exactly the chosen provider (only when its key is present).
// No cross-provider or cloud↔local fallback: a missing key / down sidecar leaves NO
// endpoint, so image gen surfaces a clear "no backend" instead of silently routing
// somewhere the user didn't pick. Reads the pref + keys + health at call time.
async function applyImageEndpoint(): Promise<void> {
  const pref = capabilities.getPref("image")
  const localDir = findImageModel()
  // Only probe the sidecar's /health when Offline actually needs it (keeps online
  // reconciles snappy — no 1.5s health wait to seed a cloud endpoint).
  const localReady = pref.mode === "offline" && !!localDir && (await localImageHealthy())
  const target = resolveImageBackend(pref, localReady, !!byok.getKey("openai"), !!byok.getKey("openrouter"))

  // Seed the chosen backend. A transient seed failure leaves any existing row of the
  // same name in place (we never delete the TARGET below); we log it so the transient
  // no-backend window is diagnosable (a later reconcile re-seeds).
  let seeded = true
  if (target === "local" && localDir) seeded = await seedLocalImage(basename(localDir))
  else if (target === "openai") {
    const key = byok.getKey("openai")
    seeded = key ? await seedOpenAIImage(key) : false
  } else if (target === "openrouter") {
    const key = byok.getKey("openrouter")
    seeded = key ? await seedOpenRouterImage(key) : false
  }
  if (target !== "none" && !seeded) console.warn(`[image] seed of "${target}" failed — image gen has no backend until the next reconcile`)

  // Retire every backend the user did NOT choose, so EXACTLY the chosen one stays enabled
  // (and NONE when target === "none"). This is where the old precedence lived; there is
  // no silent fallback to a non-chosen provider or to local — retiring the unchosen rows
  // is the PRIVACY guarantee (Offline never keeps a cloud row), which is why we retire
  // even when the chosen seed failed. A failed unseed (logged) could rarely leave a stale
  // row that the next reconcile clears.
  const rows: Array<[ImageBackend, string]> = [
    ["local", IMAGE_LOCAL_NAME],
    ["openai", IMAGE_OPENAI_NAME],
    ["openrouter", IMAGE_OPENROUTER_NAME],
  ]
  for (const [kind, name] of rows) {
    if (kind !== target && !(await unseedImage(name))) console.warn(`[image] unseed of "${name}" failed — a stale endpoint may persist until the next reconcile`)
  }
}

// Reconcile the one active image endpoint to the current image pref + BYOK keys.
// Single-flight + coalesced: each pass runs the seed/unseed subprocesses to
// completion before the next starts (they must not interleave), and if any newer
// request lands mid-run we run ONE more pass afterward so the latest state
// always wins. Without this, a fire-and-forget startup reconcile could finish
// AFTER a newer byok:set/remove or capabilities:set and re-apply a stale decision.
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

// Guarded IPC → renderer. During shutdown / window close, a LATE event — a supervised
// child process exiting (→ Supervisor.onChange), a vision-status push, an image reconcile
// transition — can fire AFTER the window's webContents has been destroyed. `win?.` only
// guards NULL: a destroyed BrowserWindow is still a non-null object, so
// `win.webContents.send()` throws "Object has been destroyed" as an UNCAUGHT main-process
// exception (the crash dialog). isDestroyed() is the only reliable guard.
function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    win.webContents.send(channel, ...args)
  }
}

let lastDiffusionHealthy = false
const supervisor = new Supervisor(nightjarServices(), (statuses) => {
  latestStatus = statuses
  sendToRenderer("nightjar:status", statuses)
  // The diffusion sidecar can reach (or lose) health AFTER the startup/post-start
  // reconcile passes — a slow ~6GB cold load finishing past the readyTimeout, or a
  // crash-restart. Re-reconcile on either transition so an Offline image capability
  // activates its local endpoint once serving, and tears it down if it dies. (No cloud
  // fallback now — Offline stays Offline; the user picks Online explicitly.) NJ-6.
  const diffHealthy = statuses.some((s) => s.name === "diffusion-server" && s.state === "healthy")
  if (diffHealthy !== lastDiffusionHealthy) {
    lastDiffusionHealthy = diffHealthy
    reconcileImageEndpoint().catch((e) => console.warn("[image] diffusion-transition reconcile:", e))
  }
})

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 820,
    show: false,
    // Must stay in sync with --nj-base in src/renderer/src/index.css. The main
    // process paints this before any renderer CSS loads, so it can't read the
    // CSS var — this is the single documented theme-token drift point.
    backgroundColor: "#080A08",
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, "../preload/index.js"), sandbox: false },
  })
  win.on("ready-to-show", () => win?.show())
  // Null the ref when the window is gone so every `win?.`/sendToRenderer guard short-
  // circuits cleanly instead of touching a destroyed object (belt to sendToRenderer's
  // isDestroyed() check; also lets app.activate recreate the window on macOS).
  win.on("closed", () => {
    win = null
  })
  // A file dropped anywhere the renderer doesn't explicitly handle would otherwise make
  // Chromium NAVIGATE the window to the file:// URL — replacing the whole app with the
  // raw file. Defense-in-depth belt to the renderer's window-level drop guard: never let
  // a drag/navigation replace our single-page app. (External links open in the browser.)
  win.webContents.on("will-navigate", (e, url) => {
    // Anchor to the ACTUAL current document URL, not a loose "file://" prefix: in a
    // packaged build ELECTRON_RENDERER_URL is unset, so a "file://" prefix would treat a
    // dropped file's own file:// path as in-app navigation and fail to block it (Bugbot).
    // Same-URL navigations (a dev full-reload / HMR) are allowed; anything else is blocked.
    if (url !== win?.webContents.getURL()) {
      e.preventDefault()
      if (/^https?:\/\//.test(url)) shell.openExternal(url)
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, "../renderer/index.html"))
}

ipcMain.handle("nightjar:config", () => ({
  opencodeUrl: OPENCODE_URL,
  sideChannelUrl: SIDE_CHANNEL_URL,
  isWSL: isWSL(), // renderer uses this to swap the drag-drop zone for a browse-instead fallback
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
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024 // 100 MB (raised from 25 MB — a large phone
// photo could exceed 25 MB and get REJECTED, and pickAttachments used to swallow that
// error, so Browse looked broken. The renderer now surfaces over-cap errors too.)
const mb = (n: number): string => (n / (1024 * 1024)).toFixed(0)

// Persisted UI settings (currently just the folder the attach picker last used, so it
// reopens where you left off). Tiny JSON in userData; every access is best-effort and
// never blocks the dialog.
const UI_SETTINGS_PATH = (): string => join(app.getPath("userData"), "ui-settings.json")
async function readUiSettings(): Promise<{ lastAttachmentDir?: string }> {
  try {
    return JSON.parse(await readFile(UI_SETTINGS_PATH(), "utf8"))
  } catch {
    return {}
  }
}
async function writeUiSettings(patch: Record<string, unknown>): Promise<void> {
  try {
    const merged = { ...(await readUiSettings()), ...patch }
    await mkdir(dirname(UI_SETTINGS_PATH()), { recursive: true })
    await writeFile(UI_SETTINGS_PATH(), JSON.stringify(merged, null, 2))
  } catch {
    /* best-effort — a settings-write failure must never break attaching a file */
  }
}
// Where the attach picker should open: the folder last used (if it still exists), else —
// under WSL — the Windows user profile (`/mnt/c/Users`), because the Linux home holds none
// of the user's real documents/images and the picker opening there made "there are no
// files to attach" look like a bug. Native Windows/macOS/Linux fall through to the OS
// default. (If a GTK/xdg-portal backend ignores defaultPath, that's a portal-version issue,
// tracked in NJ-26 — the value we pass here is correct regardless.)
async function attachmentDefaultPath(): Promise<string | undefined> {
  const last = (await readUiSettings()).lastAttachmentDir
  if (last && existsSync(last)) return last
  return isWSL() && existsSync("/mnt/c/Users") ? "/mnt/c/Users" : undefined
}

// Open the native file dialog; returns absolute paths ([] if cancelled).
ipcMain.handle("nightjar:pickFiles", async (): Promise<string[]> => {
  const opts: Electron.OpenDialogOptions = {
    title: "Attach files",
    defaultPath: await attachmentDefaultPath(),
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"] },
      { name: "Documents", extensions: ["pdf", "txt", "md", "json", "csv", "log"] },
      { name: "All files", extensions: ["*"] },
    ],
  }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (r.canceled) return []
  if (r.filePaths[0]) void writeUiSettings({ lastAttachmentDir: dirname(r.filePaths[0]) }) // reopen here next time
  return r.filePaths
})

// Read a user-picked file (from the dialog) → base64 data URL + metadata. The user
// explicitly chose it, so no root-guard (unlike readAudio); a size cap applies.
ipcMain.handle(
  "nightjar:readAttachment",
  async (_e, filePath: string): Promise<{ name: string; mime: string; dataUrl: string; size: number; path: string }> => {
    const abs = resolve(String(filePath))
    const buf = await readFile(abs)
    if (buf.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`file is too large (${mb(buf.byteLength)} MB; max ${mb(MAX_ATTACHMENT_BYTES)} MB)`)
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
  if (buf.byteLength > MAX_ATTACHMENT_BYTES) throw new Error(`file is too large (${mb(buf.byteLength)} MB; max ${mb(MAX_ATTACHMENT_BYTES)} MB)`)
  await mkdir(ATTACHMENTS_DIR, { recursive: true })
  const ext = extname(String(name)) || "." + ((m[1].split("/")[1] || "bin").replace("jpeg", "jpg"))
  const abs = join(ATTACHMENTS_DIR, `${randomUUID().slice(0, 12)}${ext}`)
  await writeFile(abs, buf, { mode: 0o600 })
  return abs
})

// WSL clipboard-image paste workaround (NJ-28). Windows delivers a copied bitmap to the
// WSL DOM clipboard as a BI_BITFIELDS BMP that Chromium can't decode, so image PASTE
// silently fails under WSL (text pastes fine). Read the Windows clipboard directly via
// PowerShell and return a PNG data URL. Only runs under WSL; returns null gracefully when
// powershell.exe is unreachable, the clipboard has no image, or anything errors. Bounded
// by a wall-clock timeout (rule 3) so a wedged powershell can't hang the paste.
const PS_CLIPBOARD_IMAGE_CMD =
  "Add-Type -AssemblyName System.Windows.Forms; " +
  "$img=[System.Windows.Forms.Clipboard]::GetImage(); " +
  "if($img){$ms=New-Object System.IO.MemoryStream; $img.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray())}"
ipcMain.handle("nightjar:readWindowsClipboardImage", async (): Promise<string | null> => {
  if (!isWSL()) return null // native Windows/macOS/Linux use the normal DOM clipboard path
  return new Promise<string | null>((done) => {
    let out = ""
    let settled = false
    const finish = (v: string | null) => {
      if (settled) return
      settled = true
      done(v)
    }
    const child = spawn("powershell.exe", ["-NonInteractive", "-NoProfile", "-Command", PS_CLIPBOARD_IMAGE_CMD], {
      timeout: 8000, // kills a wedged powershell (rule 3)
      // Discard stderr: Add-Type/warning noise on a full stderr PIPE would block powershell
      // and starve stdout until the timeout (Bugbot). We only care about stdout's base64.
      stdio: ["ignore", "pipe", "ignore"],
    })
    child.stdout?.on("data", (b: Buffer) => {
      out += b.toString()
      if (out.length > 200 * 1024 * 1024) { child.kill(); finish(null) } // guard runaway output
    })
    child.on("error", () => finish(null)) // powershell.exe not reachable → graceful no-op
    child.on("exit", (code, signal) => {
      // Trust the output ONLY on a clean exit. A timeout/kill (signal set) or non-zero exit
      // may have left PARTIAL base64 mid-write — that must become null, not a truncated,
      // broken data:image/png attachment (Bugbot).
      if (signal || code !== 0) return finish(null)
      const b64 = out.trim().replace(/\s+/g, "")
      // a real base64 PNG is well over this; anything shorter is empty/garbage → null
      finish(/^[A-Za-z0-9+/=]+$/.test(b64) && b64.length > 100 ? `data:image/png;base64,${b64}` : null)
    })
  })
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

// ── Live-preview / Artifacts IPC ──────────────────────────────────────────────
// The renderer mirrors each write/edit tool-call's content into a per-session
// sandbox (~/.nightjar/preview/<sessionID>/) served by the in-process loopback
// static server (preview-server.ts). See AUDIT §10 #4. All paths are sandbox-guarded
// inside preview-server; sessionID is sanitized to one dir segment there.
ipcMain.handle(
  "nightjar:previewWrite",
  async (_e, sessionID: string, filePath: string, content: string): Promise<{ url: string; nonce: number; rel: string }> => {
    const rel = preview.normalizeRel(filePath, WORKSPACE)
    await preview.writePreviewFile(sessionID, rel, content)
    const url = await preview.previewUrl(sessionID)
    return { url, nonce: Date.now(), rel }
  },
)
// Apply an edit tool's find/replace to the mirrored copy. If we haven't mirrored the
// file yet, seed from the agent's current on-disk copy (best-effort — git-gate may
// have rolled it back) so the preview still reflects post-edit content.
ipcMain.handle(
  "nightjar:previewEdit",
  async (_e, sessionID: string, filePath: string, oldString: string, newString: string, replaceAll: boolean): Promise<{ url: string; nonce: number; rel: string }> => {
    const rel = preview.normalizeRel(filePath, WORKSPACE)
    let base: string | undefined
    try {
      base = await readFile(join(WORKSPACE, rel), "utf8")
    } catch {
      /* not on disk — rely on the mirrored copy */
    }
    await preview.editPreviewFile(sessionID, rel, oldString, newString, !!replaceAll, base)
    const url = await preview.previewUrl(sessionID)
    return { url, nonce: Date.now(), rel }
  },
)
ipcMain.handle("nightjar:previewUrl", (_e, sessionID: string, entry?: string): Promise<string> => preview.previewUrl(sessionID, entry))
ipcMain.handle("nightjar:previewList", (_e, sessionID: string) => preview.listPreview(sessionID))
ipcMain.handle("nightjar:previewRead", (_e, sessionID: string, relPath: string) => preview.readPreview(sessionID, relPath))

// Save a generated artifact to a user-chosen location, native format, any type.
ipcMain.handle("nightjar:saveFileAs", async (_e, sessionID: string, relPath: string): Promise<boolean> => {
  const { abs, bytes } = await preview.readPreviewBytes(sessionID, relPath)
  const opts: Electron.SaveDialogOptions = { title: "Save file", defaultPath: basename(abs) }
  const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (r.canceled || !r.filePath) return false
  await writeFile(r.filePath, bytes)
  return true
})
// Reveal the generated file (or the session sandbox) in the OS file manager.
ipcMain.handle("nightjar:previewReveal", async (_e, sessionID: string, relPath?: string): Promise<void> => {
  const target = relPath ? preview.readPreviewBytes(sessionID, relPath).then((r) => r.abs).catch(() => preview.sandboxRoot(sessionID)) : Promise.resolve(preview.sandboxRoot(sessionID))
  shell.showItemInFolder(await target)
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
  // If the image capability is Online with THIS provider, storing the key lets its
  // endpoint seed — re-apply the explicit image pref (no precedence; applyImageEndpoint
  // seeds only the chosen backend). A key for a provider the user hasn't selected for
  // image gen changes nothing.
  if (providerId === "openai" || providerId === "openrouter") await reconcileImageEndpoint()
  await supervisor.restartService("opencode-serve", opencodeServeEnv())
})
ipcMain.handle("byok:remove", async (_e, providerId: string) => {
  byok.removeKey(providerId)
  // Re-apply the explicit image pref: if the removed key was the one the image
  // capability points at, its endpoint is torn down (NO silent fallback to the other
  // provider — the UI flags the missing key and the user re-picks).
  if (providerId === "openai" || providerId === "openrouter") await reconcileImageEndpoint()
  await supervisor.restartService("opencode-serve", opencodeServeEnv())
})

// ── Per-capability provider preferences (Online/Offline + provider) ───────────
// The single source of truth for the explicit local-vs-cloud + provider choice per
// capability (chat/image/research/vision/browser). On change we APPLY the choice:
// image re-seeds its single endpoint here (PR3); browser/research/vision engine-env
// apply (which needs an opencode-serve restart) lands in PR4-6. chat needs no apply —
// it's threaded per-prompt from the renderer.
ipcMain.handle("capabilities:catalog", () => ({ capabilities: capabilities.CAPABILITIES, ui: capabilities.UI_CAPABILITIES }))
ipcMain.handle("capabilities:list", () => capabilities.listPrefs())
ipcMain.handle("capabilities:set", async (_e, id: string, pref: capabilities.CapabilityPref) => {
  const saved = capabilities.setPref(id, pref)
  if (id === "image") await reconcileImageEndpoint() // seed the newly-chosen image backend
  // Browser, research, and vision are resolved from engine env at MCP-spawn time, so
  // applying their choice needs an opencode-serve restart to re-inject the
  // NIGHTJAR_{BROWSERUSE,RESEARCH,VISION}_PROVIDER vars.
  if (id === "browser" || id === "research" || id === "vision")
    await supervisor.restartService("opencode-serve", opencodeServeEnv())
  return saved
})

// The global Local/Cloud toggle flips several capability prefs at once. Persist them in
// ONE store write, then apply with exactly ONE image reconcile + ONE engine restart —
// instead of up to four (one per changed capability) if the renderer looped setPref. The
// restart re-injects NIGHTJAR_{BROWSERUSE,RESEARCH,VISION}_PROVIDER; the reconcile seeds
// the image endpoint. We run both unconditionally here rather than diffing which ids
// changed: the toggle already touches image + at least one env-applied capability on every
// switch, so the "did anything relevant change" check would essentially always be true, and
// a redundant reconcile/restart is cheap and safe next to the alternative (a stale backend).
ipcMain.handle("capabilities:setBulk", async (_e, prefs: Record<string, capabilities.CapabilityPref>) => {
  const saved = capabilities.setBulk(prefs) // throws on any unknown id → no partial write
  await reconcileImageEndpoint()
  await supervisor.restartService("opencode-serve", opencodeServeEnv())
  return saved
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
  sendToRenderer("nightjar:visionStatus", s)
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

// CAD (Task 5): convert a model-exported STEP file to a GLB the three.js viewer loads.
// Runs the trusted phase-cad converter under a wall-clock timeout (rule 3, in cad.ts).
ipcMain.handle("cad:convert", (_e, stepPath: string) => convertStepToGlb(stepPath))
// Read a converted GLB's bytes for the renderer's GLTFLoader.
ipcMain.handle("cad:readGlb", (_e, glbPath: string) => readGlb(glbPath))
// Build + convert the pre-authored planetary-gearset hero (the reliable demo).
ipcMain.handle("cad:loadHero", () => buildHeroModel())

app.whenReady().then(() => {
  createWindow()
  // Local reminder scheduler (Task 6 free tier): poll for due tasks + fire desktop
  // notifications while the app is open. Gated on the odysseus venv inside start().
  startLocalScheduler()
  // Inject any stored BYOK keys into opencode-serve's env before it starts.
  supervisor.setEnv("opencode-serve", opencodeServeEnv())
  // Seed the image endpoint to match the persisted image-capability choice (Offline
  // local, or the chosen Online provider), so it's active from launch. Fire-and-forget:
  // never blocks the window/stack coming up.
  reconcileImageEndpoint().catch((e) => console.warn("[image] endpoint reconcile:", e))
  // fire-and-forget: bring up the stack; the health strip reflects progress. Once
  // the stack (incl. the ollama service) is up, ensure the local vision model.
  if (process.env.NIGHTJAR_NO_SUPERVISOR !== "1") {
    supervisor
      .start()
      .then(() => {
        ensureVision()
        // The startup reconcile above was fire-and-forget before the diffusion sidecar
        // was healthy; re-reconcile now so an Offline image capability activates its
        // local endpoint once the sidecar is serving (NJ-6). No-op when Online or when
        // there's no local model.
        reconcileImageEndpoint().catch((e) => console.warn("[image] post-start reconcile:", e))
      })
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
  stopLocalScheduler()
  preview.stopServer()
  await supervisor.stop().catch(() => {})
  app.quit()
})
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
