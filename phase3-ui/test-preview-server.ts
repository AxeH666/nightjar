// Offline test of the live-preview server/sandbox (preview-server.ts) — no Electron,
// no OpenCode. Exercises: path normalization, sandboxed write/list/read, the loopback
// static server (no-store headers + content), markdown→HTML rendering, and the
// traversal guard. Run: bun test-preview-server.ts
import { rm } from "node:fs/promises"
import {
  normalizeRel, writePreviewFile, listPreview, readPreview, editPreviewFile,
  ensureServer, previewUrl, sandboxRoot, stopServer,
} from "./src/main/preview-server"

const WS = "/home/user/workspace"
let pass = 0, fail = 0
const check = (n: string, ok: boolean, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"}: ${n}${extra ? " — " + extra : ""}`); ok ? pass++ : fail++ }
const sid = `test-${Date.now()}`

try {
  // 1. normalizeRel
  check("normalizeRel keeps relative", normalizeRel("preview/index.html", WS) === "preview/index.html")
  check("normalizeRel absolute-under-workspace → rel", normalizeRel(`${WS}/preview/a.css`, WS) === "preview/a.css")
  check("normalizeRel absolute-elsewhere → basename", normalizeRel("/etc/passwd", WS) === "passwd")
  check("normalizeRel strips traversal", normalizeRel("../../etc/passwd", WS) === "etc/passwd", normalizeRel("../../etc/passwd", WS))
  check("normalizeRel empty → index.html", normalizeRel("", WS) === "index.html")

  // 2. write + list + read
  await writePreviewFile(sid, "index.html", "<h1 id=x>Coffee</h1>")
  await writePreviewFile(sid, "style.css", "h1{color:#C9852E}")
  const files = await listPreview(sid)
  check("listPreview returns both files", files.length === 2 && files.some(f => f.path === "index.html") && files.some(f => f.path === "style.css"), JSON.stringify(files.map(f => f.path)))
  const read = await readPreview(sid, "style.css")
  check("readPreview returns data URL", read.mime === "text/css" && read.dataUrl.startsWith("data:text/css;base64,"))

  // 3. edit (find/replace on the mirrored copy)
  await editPreviewFile(sid, "index.html", "Coffee", "Espresso", false)
  const afterEdit = await readPreview(sid, "index.html")
  check("editPreviewFile applied", Buffer.from(afterEdit.dataUrl.split(",")[1], "base64").toString().includes("Espresso"))

  // 4. static server serves the file with no-store
  const port = await ensureServer()
  const url = await previewUrl(sid, "index.html")
  check("previewUrl shape", /^http:\/\/127\.0\.0\.1:\d+\/preview\/.+\/index\.html$/.test(url), url)
  const r = await fetch(url)
  const body = await r.text()
  check("server serves html 200", r.status === 200 && body.includes("Espresso"))
  check("server sets no-store", (r.headers.get("cache-control") || "").includes("no-store"))
  check("server sets text/html", (r.headers.get("content-type") || "").includes("text/html"))

  // 5. markdown → rendered HTML
  await writePreviewFile(sid, "doc.md", "# Title\n\n- one\n- two\n")
  const mdUrl = await previewUrl(sid, "doc.md")
  const mr = await fetch(mdUrl)
  const mdHtml = await mr.text()
  check("markdown rendered to HTML", (mr.headers.get("content-type") || "").includes("text/html") && /<h1[^>]*>Title<\/h1>/.test(mdHtml) && mdHtml.includes("<li>one</li>"), mdHtml.slice(0, 80))

  // 6. directory root serves index.html
  const rootUrl = await previewUrl(sid)
  const rr = await fetch(rootUrl)
  check("root serves index.html", rr.status === 200 && (await rr.text()).includes("Espresso"))

  // 7. traversal guard
  let threw = false
  try { await writePreviewFile(sid, "../escape.txt", "nope") } catch { threw = true }
  check("write traversal guard throws", threw)
  // server-side traversal (encoded) → 403/placeholder, never escapes
  const evil = await fetch(`http://127.0.0.1:${port}/preview/${sid}/..%2f..%2fetc%2fpasswd`)
  check("server refuses traversal", evil.status === 403 || evil.status === 404 || !(await evil.text()).includes("root:"))
} finally {
  stopServer()
  await rm(sandboxRoot(sid), { recursive: true, force: true }).catch(() => {})
}

console.log(`\n==== preview-server: ${pass} passed, ${fail} failed ====`)
process.exit(fail > 0 ? 1 : 0)
