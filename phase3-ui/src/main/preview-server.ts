// Nightjar live-preview server — the sandbox + loopback static server behind the
// Artifacts-style preview panel (AUDIT §10 #4). Pattern reimplemented from
// gemma-chat's Canvas (MIT) — NOT copied; this file is AGPL-3.0 like the rest of
// phase3-ui. Deliberately does NOT use bolt.diy WebContainers (rule 5).
//
// Model: the renderer mirrors each `write`/`edit` tool-call's content into a
// per-session sandbox under ~/.nightjar/preview/<sessionID>/, and this in-process
// Node http server serves it to a sandboxed <iframe>. Live refresh = the renderer
// bumps a cache-busting `?v=<nonce>` and every response is `no-store`, so the
// iframe re-GETs from disk. One shared server, per-session URL prefix.
import { createServer, type Server } from "node:http"
import { createReadStream } from "node:fs"
import { readFile, writeFile, mkdir, readdir, stat, rename } from "node:fs/promises"
import { homedir } from "node:os"
import { join, resolve, sep, dirname, extname, relative, isAbsolute } from "node:path"
import { marked } from "marked"

export const PREVIEW_DIR = join(homedir(), ".nightjar", "preview")

const MIME: Record<string, string> = {
  ".html": "text/html", ".htm": "text/html", ".css": "text/css",
  ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".ico": "image/x-icon", ".bmp": "image/bmp",
  ".wasm": "application/wasm", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".xml": "application/xml",
  ".pdf": "application/pdf",
}
const mimeFor = (p: string): string => MIME[extname(p).toLowerCase()] || "application/octet-stream"

// Session id → a safe single directory segment. basename-ish + strip anything odd.
const sanitizeId = (id: string): string =>
  (String(id).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "default")

export const sandboxRoot = (sessionID: string): string => join(PREVIEW_DIR, sanitizeId(sessionID))

// A tool-call's raw `filePath` → a safe workspace-relative mirror path. Absolute
// paths under the workspace become relative; absolute paths elsewhere collapse to
// their basename; traversal (`..`) segments are stripped. Never escapes the sandbox.
export function normalizeRel(filePath: string, workspace: string): string {
  let p = String(filePath || "")
  if (isAbsolute(p)) {
    const r = relative(workspace, p)
    p = r && !r.startsWith("..") ? r : (p.split(sep).pop() || "")
  }
  p = p.replace(/^\.\//, "").split(/[\\/]/).filter((s) => s && s !== "." && s !== "..").join("/")
  return p || "index.html"
}

// Resolve relPath INSIDE root or throw (traversal guard — same shape as the
// AUDIO_ROOTS/basename guards in index.ts).
function safeResolve(root: string, relPath: string): string {
  const abs = resolve(root, relPath)
  if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`path escapes sandbox: ${relPath}`)
  return abs
}

// ── mirror I/O (called from IPC) ──────────────────────────────────────────────
export async function writePreviewFile(sessionID: string, relPath: string, content: string): Promise<void> {
  const root = sandboxRoot(sessionID)
  const abs = safeResolve(root, relPath)
  await mkdir(dirname(abs), { recursive: true })
  // atomic-ish: temp write + rename so a half-written file is never served
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, content, "utf8")
  await rename(tmp, abs)
}

// Apply an `edit` tool's find/replace to the mirrored copy (reading `base` — the
// current workspace/on-disk copy — first if we haven't mirrored this file yet).
export async function editPreviewFile(
  sessionID: string,
  relPath: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  base?: string,
): Promise<void> {
  const root = sandboxRoot(sessionID)
  const abs = safeResolve(root, relPath)
  let cur = base ?? ""
  try {
    cur = await readFile(abs, "utf8")
  } catch {
    /* not mirrored yet → use provided base (may be empty) */
  }
  const next = replaceAll ? cur.split(oldString).join(newString) : cur.replace(oldString, newString)
  await writePreviewFile(sessionID, relPath, next)
}

export interface PreviewEntry {
  path: string
  size: number
}

export async function listPreview(sessionID: string): Promise<PreviewEntry[]> {
  const root = sandboxRoot(sessionID)
  const out: PreviewEntry[] = []
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue
      const abs = join(dir, e.name)
      if (e.isDirectory()) await walk(abs)
      else {
        const s = await stat(abs).catch(() => null)
        if (s) out.push({ path: relative(root, abs).split(sep).join("/"), size: s.size })
      }
    }
  }
  await walk(root)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export async function readPreview(sessionID: string, relPath: string): Promise<{ mime: string; dataUrl: string }> {
  const root = sandboxRoot(sessionID)
  const abs = safeResolve(root, relPath)
  const buf = await readFile(abs)
  const mime = mimeFor(abs)
  return { mime, dataUrl: `data:${mime};base64,${buf.toString("base64")}` }
}

// Raw bytes for save-as / reveal (returns the absolute in-sandbox path too).
export async function readPreviewBytes(sessionID: string, relPath: string): Promise<{ abs: string; bytes: Buffer }> {
  const root = sandboxRoot(sessionID)
  const abs = safeResolve(root, relPath)
  return { abs, bytes: await readFile(abs) }
}

// ── static server ─────────────────────────────────────────────────────────────
let server: Server | null = null
let port = 0

const noStore = (res: import("node:http").ServerResponse, mime: string): void => {
  res.setHeader("Content-Type", mime)
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate")
  res.setHeader("Pragma", "no-cache")
}

const PLACEHOLDER = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;
background:#14110D;color:#EDE6D6;font:14px system-ui,sans-serif}div{opacity:.5}</style></head>
<body><div>No preview yet — generate something to see it render here.</div></body></html>`

// Wrap rendered markdown in a minimal dark page matching the app theme.
function mdPage(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><style>
html,body{margin:0}body{background:#14110D;color:#EDE6D6;font:16px/1.6 system-ui,-apple-system,sans-serif;
max-width:820px;margin:0 auto;padding:32px 40px}a{color:#C9852E}
code,pre{font-family:"JetBrains Mono",ui-monospace,monospace}
pre{background:#2A2419;padding:12px 14px;border-radius:8px;overflow:auto}
code{background:#2A2419;padding:1px 5px;border-radius:4px}
pre code{background:none;padding:0}h1,h2,h3{color:#EDE6D6;border-bottom:1px solid #2A2419;padding-bottom:.3em}
table{border-collapse:collapse}th,td{border:1px solid #2A2419;padding:6px 10px}
blockquote{border-left:3px solid #C9852E;margin:0;padding-left:14px;color:#EDE6D6cc}
img{max-width:100%}</style></head><body>${html}</body></html>`
}

async function serveFile(res: import("node:http").ServerResponse, abs: string): Promise<void> {
  const ext = extname(abs).toLowerCase()
  if (ext === ".md") {
    // Render markdown → styled HTML so the Preview tab shows docs like Artifacts.
    try {
      const src = await readFile(abs, "utf8")
      const html = mdPage(String(await marked.parse(src)))
      noStore(res, "text/html")
      res.end(html)
      return
    } catch {
      res.statusCode = 404
      res.end("not found")
      return
    }
  }
  noStore(res, mimeFor(abs))
  createReadStream(abs)
    .on("error", () => {
      res.statusCode = 404
      res.end("not found")
    })
    .pipe(res)
}

export function ensureServer(): Promise<number> {
  if (server && port) return Promise.resolve(port)
  return new Promise((res, rej) => {
    const s = createServer(async (req, resp) => {
      try {
        resp.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*")
        const url = new URL(req.url ?? "/", "http://127.0.0.1")
        // /preview/<sid>/<relpath...>
        const parts = url.pathname.split("/").filter(Boolean) // ["preview","<sid>","a","b.html"]
        if (parts[0] !== "preview" || !parts[1]) {
          resp.statusCode = 404
          resp.end("not found")
          return
        }
        const sid = parts[1]
        const rel = parts.slice(2).map(decodeURIComponent).join("/")
        const root = sandboxRoot(sid)
        let abs: string
        try {
          abs = safeResolve(root, rel)
        } catch {
          resp.statusCode = 403
          resp.end("forbidden")
          return
        }
        const st = await stat(abs).catch(() => null)
        if (st?.isFile()) {
          await serveFile(resp, abs)
          return
        }
        // directory (or missing root): serve index.html if present, else placeholder
        const index = join(st?.isDirectory() ? abs : root, "index.html")
        const idx = await stat(index).catch(() => null)
        if (idx?.isFile()) {
          await serveFile(resp, index)
          return
        }
        noStore(resp, "text/html")
        resp.end(PLACEHOLDER)
      } catch {
        resp.statusCode = 500
        resp.end("error")
      }
    })
    s.on("error", rej)
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address()
      port = typeof addr === "object" && addr ? addr.port : 0
      server = s
      res(port)
    })
  })
}

export async function previewUrl(sessionID: string, entry?: string): Promise<string> {
  const p = await ensureServer()
  const tail = entry ? entry.split("/").map(encodeURIComponent).join("/") : ""
  return `http://127.0.0.1:${p}/preview/${sanitizeId(sessionID)}/${tail}`
}

export function stopServer(): void {
  server?.close()
  server = null
  port = 0
}
