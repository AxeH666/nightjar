// Nightjar ↔ OpenCode HTTP/SSE client — built to the confirmed server contract
// (research/AUDIT_REPORT.md §9). Portable: uses fetch + a ReadableStream SSE
// parser so the exact same module runs in the Electron renderer AND in the
// headless Node integration test.
//
// Contract points implemented:
//  • POST /session                          → create a session
//  • POST /session/:id/prompt_async         → run a prompt in a chosen agent (mode); returns 204
//  • GET  /event  (text/event-stream)       → instance-wide bus; we filter by sessionID client-side
//  • GET  /agent                            → enumerate selectable modes (hidden!==true, mode!=="subagent")
//  • POST /permission/:requestID/reply      → { reply: "once"|"always"|"reject", message? }
//  • POST /session/:id/abort                → escape hatch for an unanswered (indefinitely-blocking) permission

export type ReplyKind = "once" | "always" | "reject"

export interface AgentInfo {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden?: boolean
  native?: boolean // true for OpenCode's built-in agents (build/plan); Nightjar's own modes are false
}

// A session as returned by GET /session (list) or POST /session (create).
export interface SessionInfo {
  id: string
  title?: string
  agent?: string
  parentID?: string
  time?: { created?: number; updated?: number }
}

// A message plus its ordered parts, as returned by GET /session/:id/message.
// Used to rehydrate a resumed conversation into the UI's UiMessage[] shape.
export interface MessageWithParts {
  info: { id: string; role: "user" | "assistant"; time?: { created?: number }; [k: string]: unknown }
  parts: any[]
}

export interface PermissionAsk {
  id: string
  sessionID: string
  permission: string
  patterns?: string[]
  metadata?: Record<string, unknown>
  always?: string[]
  tool?: { messageID: string; callID: string }
}

// A tool call, assembled from successive message.part.updated events (same callID).
export interface ToolCall {
  callID: string
  tool: string
  status: "pending" | "running" | "completed" | "error"
  input?: unknown
  output?: string
  error?: string
  title?: string
}

export interface OpenCodeEvent {
  type: string
  properties: any
}

// An attachment sent alongside a prompt. `url` is a base64 data URL
// (`data:<mime>;base64,…`) — OpenCode requires that for remote image/file parts.
export interface FilePart {
  mime: string
  url: string
  filename?: string
}

export class OpenCodeClient {
  constructor(
    private baseUrl: string,
    private authToken?: string, // base64(user:pass); only when OPENCODE_SERVER_PASSWORD is set
  ) {}

  private url(path: string): string {
    const u = new URL(path, this.baseUrl)
    if (this.authToken) u.searchParams.set("auth_token", this.authToken)
    return u.toString()
  }
  private headers(): Record<string, string> {
    const h: Record<string, string> = { "content-type": "application/json" }
    if (this.authToken) h["authorization"] = `Basic ${this.authToken}`
    return h
  }

  async listAgents(): Promise<AgentInfo[]> {
    const res = await fetch(this.url("/agent"), { headers: this.headers() })
    if (!res.ok) throw new Error(`GET /agent → ${res.status}`)
    const all: AgentInfo[] = await res.json()
    // Selectable Nightjar "modes" only: exclude subagents, hidden agents, AND
    // OpenCode's built-in `native` agents (build/plan) — those aren't Nightjar
    // modes and cluttered the mode selector (NJ-2). Any agent we define in
    // opencode.json comes back native:false, so this needs no hardcoded name list.
    return all.filter((a) => a.hidden !== true && a.mode !== "subagent" && a.native !== true)
  }

  async createSession(title?: string): Promise<string> {
    const res = await fetch(this.url("/session"), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(title ? { title } : {}),
    })
    if (!res.ok) throw new Error(`POST /session → ${res.status}: ${await res.text()}`)
    return (await res.json()).id
  }

  // Fire-and-forget: run a prompt under `agent` (our mode). Events arrive via subscribe().
  // `model` is a "providerID/modelID" string; OpenCode expects a ModelRef object.
  // `files` are attachments: OpenCode's `file` part type where `url` MUST be a base64
  // data URL (`data:<mime>;base64,…`) for a remote client — there is no separate
  // "image" part type (images are `file` with an image/* mime) and no path field.
  async promptAsync(
    sessionID: string,
    text: string,
    agent: string,
    model?: string,
    files?: FilePart[],
  ): Promise<void> {
    let modelRef: { providerID: string; modelID: string } | undefined
    if (model) {
      const slash = model.indexOf("/")
      if (slash > 0) modelRef = { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) }
    }
    const parts: Array<Record<string, unknown>> = [{ type: "text", text }]
    for (const f of files ?? []) {
      parts.push({ type: "file", mime: f.mime, url: f.url, ...(f.filename ? { filename: f.filename } : {}) })
    }
    const res = await fetch(this.url(`/session/${sessionID}/prompt_async`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ agent, ...(modelRef ? { model: modelRef } : {}), parts }),
    })
    if (!res.ok && res.status !== 204) {
      throw new Error(`POST prompt_async → ${res.status}: ${await res.text()}`)
    }
  }

  async replyPermission(requestID: string, reply: ReplyKind, message?: string): Promise<void> {
    const res = await fetch(this.url(`/permission/${requestID}/reply`), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ reply, ...(message ? { message } : {}) }),
    })
    if (!res.ok) throw new Error(`POST permission reply → ${res.status}: ${await res.text()}`)
  }

  async abort(sessionID: string): Promise<void> {
    // rule 3: a POST to a wedged/unreachable engine must not hang the Stop control
    // forever — bound it so the caller's catch runs (busy stays true → Stop stays).
    const res = await fetch(this.url(`/session/${sessionID}/abort`), {
      method: "POST",
      headers: this.headers(),
      signal: AbortSignal.timeout(10000),
    })
    // 404 = the session no longer exists server-side → nothing left to interrupt;
    // treat as done so the caller clears busy (no soft-wedge). Other failures
    // (5xx / network / timeout) still throw → busy stays true, Stop stays.
    if (!res.ok && res.status !== 404) throw new Error(`POST abort → ${res.status}`)
  }

  // List all sessions (server returns most-recently-updated first). GET /session.
  // Powers the Code tab's resumable session-history list.
  async listSessions(): Promise<SessionInfo[]> {
    const res = await fetch(this.url("/session"), { headers: this.headers() })
    if (!res.ok) throw new Error(`GET /session → ${res.status}`)
    return (await res.json()) as SessionInfo[]
  }

  // Full message history for a session (limit omitted → ALL messages).
  // GET /session/:id/message → WithParts[] = { info, parts }[]. Used to rehydrate
  // a resumed conversation; order defensively by info.time.created when mapping.
  async getMessages(sessionID: string): Promise<MessageWithParts[]> {
    const res = await fetch(this.url(`/session/${sessionID}/message`), { headers: this.headers() })
    if (!res.ok) throw new Error(`GET /session/${sessionID}/message → ${res.status}`)
    return (await res.json()) as MessageWithParts[]
  }

  // Delete a session. DELETE /session/:id → boolean.
  async deleteSession(sessionID: string): Promise<void> {
    const res = await fetch(this.url(`/session/${sessionID}`), { method: "DELETE", headers: this.headers() })
    if (!res.ok) throw new Error(`DELETE /session/${sessionID} → ${res.status}`)
  }

  // Rename a session. PATCH /session/:id { title } → Session.Info.
  async renameSession(sessionID: string, title: string): Promise<void> {
    const res = await fetch(this.url(`/session/${sessionID}`), {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ title }),
    })
    if (!res.ok) throw new Error(`PATCH /session/${sessionID} → ${res.status}`)
  }

  // Subscribe to the instance-wide SSE stream. `signal` to stop. Callback gets
  // every event; callers filter by sessionID (the stream is not session-scoped).
  async subscribe(onEvent: (e: OpenCodeEvent) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(this.url("/event"), { headers: this.headers(), signal })
    if (!res.ok || !res.body) throw new Error(`GET /event → ${res.status}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      // SSE frames separated by blank line; each frame has data: lines
      let idx: number
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const dataLines = frame
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trim())
        if (dataLines.length === 0) continue
        try {
          onEvent(JSON.parse(dataLines.join("\n")))
        } catch {
          /* heartbeat / non-JSON frame */
        }
      }
    }
  }
}

// Fold a message.part.updated event's ToolPart into a ToolCall (keyed by callID).
export function toolCallFromPart(part: any): ToolCall | null {
  if (!part || part.type !== "tool") return null
  const st = part.state ?? {}
  return {
    callID: part.callID,
    tool: part.tool,
    status: st.status ?? "pending",
    input: st.input,
    output: st.output,
    error: st.error,
    title: st.title,
  }
}
