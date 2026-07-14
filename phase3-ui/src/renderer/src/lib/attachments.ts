// Renderer-side chat attachment helpers. Talks to the main process over the preload
// bridge. An Attachment carries the base64 data URL (sent to OpenCode as a `file`
// part) and, for images, an on-disk `path` (for the local `nightjar_analyze_image`
// tool, which takes a path — the model-facing file part only reaches vision-capable
// cloud models). Paste, drag-drop and native browse all produce the same Attachment.

export interface Attachment {
  id: string
  name: string
  mime: string
  dataUrl: string // "data:<mime>;base64,…" — the file part's `url`
  size: number
  path?: string // absolute disk path (images) for the local vision tool
  isImage: boolean
}

// Result of a batch attach (Browse / drop / paste): the attachments that succeeded PLUS
// human-readable errors for the ones that didn't. Errors are SURFACED (shown in the
// composer) instead of silently dropped — a swallowed read error is exactly why
// "Browse → pick a file → no chip appears" looked like the feature was broken.
export interface AttachmentResult {
  attachments: Attachment[]
  errors: string[]
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const baseName = (p: string): string => p.split(/[\\/]/).pop() || p

interface AttachmentBridge {
  pickFiles(): Promise<string[]>
  readAttachment(path: string): Promise<{ name: string; mime: string; dataUrl: string; size: number; path: string }>
  saveAttachment(dataUrl: string, name: string): Promise<string>
  readGeneratedImage(filename: string): Promise<string | null>
}

function bridge(): AttachmentBridge | null {
  return (window as unknown as { nightjar?: AttachmentBridge }).nightjar ?? null
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/")
}

let _seq = 0
const nextId = (): string => `att-${Date.now()}-${_seq++}`

// A pasted/dragged browser File → Attachment. Reads it as a data URL; for images,
// also saves it to disk (best-effort) so the local vision tool has a path.
export async function fileToAttachment(file: File): Promise<Attachment> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error)
    r.readAsDataURL(file)
  })
  const mime = file.type || "application/octet-stream"
  const isImage = isImageMime(mime)
  const name = file.name || (isImage ? "pasted-image.png" : "attachment")
  let path: string | undefined
  if (isImage) {
    try {
      path = await bridge()?.saveAttachment(dataUrl, name)
    } catch {
      /* best-effort: cloud vision still works via the data-URL part */
    }
  }
  return { id: nextId(), name, mime, dataUrl, size: file.size, path, isImage }
}

// Native "Browse Files" → Attachments. Opens the OS dialog, reads each pick (the
// browse path IS the on-disk path, so images are already reachable by the vision tool).
// A per-file read failure (e.g. over the size cap) is now RETURNED as an error string
// rather than silently swallowed, so the composer can tell the user why nothing attached.
export async function pickAttachments(): Promise<AttachmentResult> {
  const b = bridge()
  if (!b) return { attachments: [], errors: [] }
  const paths = await b.pickFiles()
  const attachments: Attachment[] = []
  const errors: string[] = []
  for (const p of paths) {
    try {
      const a = await b.readAttachment(p)
      attachments.push({ id: nextId(), name: a.name, mime: a.mime, dataUrl: a.dataUrl, size: a.size, path: a.path, isImage: isImageMime(a.mime) })
    } catch (e) {
      errors.push(`Couldn't attach ${baseName(p)}: ${errText(e)}`)
    }
  }
  return { attachments, errors }
}

// Collect image/file attachments from a paste or drop DataTransfer. Per-file failures
// are surfaced (not swallowed) so a bad file gives a reason instead of a silent no-op.
export async function attachmentsFromDataTransfer(dt: DataTransfer | null): Promise<AttachmentResult> {
  if (!dt) return { attachments: [], errors: [] }
  const files: File[] = []
  if (dt.files && dt.files.length) files.push(...Array.from(dt.files))
  else if (dt.items) {
    for (const it of Array.from(dt.items)) {
      if (it.kind === "file") {
        const f = it.getAsFile()
        if (f) files.push(f)
      }
    }
  }
  const attachments: Attachment[] = []
  const errors: string[] = []
  for (const f of files) {
    try {
      attachments.push(await fileToAttachment(f))
    } catch (e) {
      errors.push(`Couldn't attach ${f.name || "file"}: ${errText(e)}`)
    }
  }
  return { attachments, errors }
}

// Read a generated image (filename parsed from the generate_image tool output) for
// inline display — the tool returns a web link that isn't served in the desktop app.
export async function loadGeneratedImage(filename: string): Promise<string | null> {
  return (await bridge()?.readGeneratedImage(filename)) ?? null
}

const fmtSize = (n: number): string => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`)
export { fmtSize }
