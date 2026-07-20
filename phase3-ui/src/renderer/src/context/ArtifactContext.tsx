// ArtifactContext — the live-preview / Artifacts panel state (AUDIT §10 #4) and
// the write/edit mirror pipeline. SessionsContext's tool-call reducer delegates
// here via onToolCall(); the panel content is served from a per-session sandbox
// by the main process (main/preview-server.ts) and rendered in a sandboxed iframe.
//
// Sits OUTSIDE SessionsContext in the provider tree so the session reducer (inner)
// can call onToolCall (outer). Resets on sessionID change — a fresh connect or a
// reconnect gets a new session id, so stale artifact paths from the previous
// (now-empty) sandbox must be dropped.
//
// Extracted from the former App.tsx monolith (redesign Stage 2), verbatim.
import { createContext, useCallback, useContext, useRef, useState } from "react"
import type { ReactNode } from "react"
import { artifactActionFromTool, previewBridge } from "../lib/preview"
import type { ToolCall } from "../lib/opencode"

// Prefer the newest .html as the active preview entry; otherwise the latest file.
const preferHtml = (prev: string, rel: string): string =>
  /\.html?$/i.test(rel) ? rel : /\.html?$/i.test(prev) ? prev : rel

interface LiveCode {
  rel: string
  content: string
  streaming: boolean
  callID: string // which write tool-call this preview belongs to (so a completion only clears ITS own streaming flag)
}

interface ArtifactValue {
  panelOpen: boolean
  setPanelOpen: (v: boolean) => void
  activeEntry: string
  setActiveEntry: (v: string) => void
  previewNonce: number
  liveCode: LiveCode | null
  // Which session the current panel content belongs to. The panel state is a singleton but
  // multiple screens (Chat, Code) consume it against DIFFERENT session sandboxes, so each
  // screen renders its panel only when artifactSession === its own session id (no cross-talk).
  artifactSession: string
  // Mirror a coding-agent write/edit tool-call into the session sandbox + open the panel.
  onToolCall: (call: ToolCall, sessionID: string) => void
  // "Canvas from message": mirror raw content the user chose to open/download from a chat
  // artifact card into the session sandbox (open → panel; download → native save dialog).
  openArtifactFromContent: (sid: string, name: string, content: string) => void
  downloadArtifactContent: (sid: string, name: string, content: string) => void
  // Drop all live-preview state. Called on any underlying-session change this
  // provider can't observe itself — notably a Code-tab session switch (CodeScreen);
  // this provider sits above SessionsContext and so never sees the code slot's id.
  resetPreview: () => void
  // Reset the preview ONLY when the code slot's session id actually changes. The
  // "previous id" lives here (persistent provider), so a bare CodeScreen remount
  // (Chat↔Code tab switch) with an unchanged id no longer wipes the panel.
  syncCodeSession: (codeSessionId: string) => void
  // Same, for the chat slot — so a pinned chat's preview survives a reconnect (the chat
  // session id is unchanged) instead of being wiped by the connection's primary changing.
  syncChatSession: (chatSessionId: string) => void
}

const Ctx = createContext<ArtifactValue | null>(null)

export function useArtifact(): ArtifactValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useArtifact must be used within an ArtifactProvider")
  return v
}

export function ArtifactProvider({ children }: { children: ReactNode }) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [activeEntry, setActiveEntry] = useState<string>("")
  const [previewNonce, setPreviewNonce] = useState(0)
  const [liveCode, setLiveCode] = useState<LiveCode | null>(null)
  const [artifactSession, setArtifactSession] = useState<string>("")
  // callID → last mirrored content length, so we only re-mirror on growth/completion
  // (a tool part arrives repeatedly as pending→running→completed snapshots).
  const artifactSeen = useRef<Map<string, number>>(new Map())
  // The session the mirrored artifacts currently belong to. Tracked here (a ref,
  // set from the write path's sid) so a session change is detected synchronously
  // at mirror time — independent of the async `sessionID`-state reset effect below.
  const artifactSessionRef = useRef<string>("")
  // The code slot's session id we last reset for. Persistent (this provider never
  // unmounts on a tab switch), so CodeScreen can call syncCodeSession on every
  // mount and we reset only on a real id change — not on a bare tab-switch remount.
  const codeSessionRef = useRef<string>("")
  const chatSessionRef = useRef<string>("")
  const nonceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const bumpNonce = useCallback(() => {
    if (nonceTimer.current) clearTimeout(nonceTimer.current)
    nonceTimer.current = setTimeout(() => setPreviewNonce(Date.now()), 300)
  }, [])

  // Drop every trace of the previous session's live preview (panel open state,
  // active entry, mirrored content, nonce, dedup map, and the artifact-session
  // anchor) so the panel never shows stale paths against a new (empty) sandbox.
  const resetPreview = useCallback(() => {
    setPanelOpen(false)
    setActiveEntry("")
    setLiveCode(null)
    setPreviewNonce(0)
    setArtifactSession("")
    artifactSeen.current.clear()
    artifactSessionRef.current = ""
  }, [])

  // Reset the preview when a slot's session id truly changes (new/resumed session), never on a
  // bare tab-switch remount (unchanged id). CRUCIAL: the panel state is a SINGLETON shared by
  // Chat + Code, so a change in one slot must NOT wipe the OTHER slot's still-valid preview — we
  // reset only when the departing session actually owned the currently-shown artifacts. This is
  // why a reconnect (which recreates the code session) no longer dismisses an open canvas on a
  // pinned, unchanged chat conversation (Bugbot). Screens drive this via useEffect on their slot id.
  const syncSlotSession = useCallback(
    (ref: { current: string }, sessionId: string) => {
      if (!sessionId || sessionId === ref.current) return
      if (artifactSessionRef.current === ref.current) resetPreview() // only wipe if these are the shown artifacts
      ref.current = sessionId
    },
    [resetPreview],
  )
  const syncCodeSession = useCallback((codeSessionId: string) => syncSlotSession(codeSessionRef, codeSessionId), [syncSlotSession])
  const syncChatSession = useCallback((chatSessionId: string) => syncSlotSession(chatSessionRef, chatSessionId), [syncSlotSession])

  const onToolCall = useCallback(
    (call: ToolCall, sid: string) => {
      // Live-preview: mirror the coding agent's write/edit file content into the
      // per-session sandbox and open the Artifacts panel. Re-mirror only when the
      // content grows/completes (the same tool part arrives repeatedly).
      const action = artifactActionFromTool(call)
      const pv = previewBridge()
      if (!action || !pv || !sid) return
      // First artifact activity for a new session (e.g. after a reconnect) → drop
      // the previous session's dedup state synchronously, BEFORE mirroring, so a
      // write can never be deduped against — or the panel show — a stale session's
      // sandbox. This is tied to the write path's `sid`, not the async reset effect.
      if (sid !== artifactSessionRef.current) {
        artifactSessionRef.current = sid
        artifactSeen.current.clear()
      }
      const len = action.kind === "write" ? action.content.length : action.newString.length
      const streaming = call.status !== "completed"
      if (artifactSeen.current.get(call.callID) === len) {
        // Same content already mirrored — but the tool's terminal `completed`
        // snapshot often carries the SAME length as the last `running` one, so a
        // blind early-return would leave liveCode.streaming stuck true forever.
        // Clear the streaming flag on completion (do NOT re-run pv.write/pv.edit:
        // the write is idempotent but a re-edit would fail to re-match oldString).
        // Guard on callID: with overlapping tool calls, liveCode may already belong
        // to a LATER, still-streaming write — an earlier call's terminal snapshot
        // must not clear that one's flag.
        if (!streaming) setLiveCode((lc) => (lc && lc.streaming && lc.callID === call.callID ? { ...lc, streaming: false } : lc))
        return
      }
      artifactSeen.current.set(call.callID, len)
      setPanelOpen(true)
      setArtifactSession(sid) // this write's session owns the panel now (screen gates on it)
      if (action.kind === "write") {
        setLiveCode({ rel: action.filePath.split(/[\\/]/).pop() || action.filePath, content: action.content, streaming, callID: call.callID })
        pv.write(sid, action.filePath, action.content)
          .then(({ rel }) => {
            setActiveEntry((prev) => preferHtml(prev, rel))
            setLiveCode((lc) => (lc ? { ...lc, rel } : lc))
            bumpNonce()
          })
          .catch((e) => console.error("[artifact] tool-call mirror write failed", { sid, filePath: action.filePath }, e))
      } else {
        pv.edit(sid, action.filePath, action.oldString, action.newString, action.replaceAll)
          .then(({ rel }) => {
            setActiveEntry((prev) => preferHtml(prev, rel))
            bumpNonce()
          })
          .catch((e) => console.error("[artifact] tool-call mirror edit failed", { sid, filePath: action.filePath }, e))
      }
    },
    [bumpNonce],
  )

  // Canvas from a chat message: mirror content the assistant emitted (a detected artifact
  // card) into the session sandbox and open the panel — the "open" path. No streaming; the
  // user explicitly chose THIS artifact, so it becomes the active entry.
  const openArtifactFromContent = useCallback(
    (sid: string, name: string, content: string) => {
      const pv = previewBridge()
      if (!pv || !sid) return
      artifactSessionRef.current = sid
      setArtifactSession(sid)
      setPanelOpen(true)
      setLiveCode({ rel: name, content, streaming: false, callID: `msg:${sid}:${name}` })
      pv.write(sid, name, content)
        .then(({ rel }) => {
          setActiveEntry(rel)
          setLiveCode((lc) => (lc ? { ...lc, rel } : lc))
          bumpNonce()
        })
        .catch((e) => console.error("[artifact] open: mirror write failed", { sid, name }, e))
    },
    [bumpNonce],
  )

  // Download path for a chat artifact card: mirror the content, then open the native
  // save-as dialog on the mirrored file.
  const downloadArtifactContent = useCallback((sid: string, name: string, content: string) => {
    const pv = previewBridge()
    if (!pv || !sid) return
    pv.write(sid, name, content)
      .then(({ rel }) => pv.saveAs(sid, rel))
      .catch((e) => console.error("[artifact] download: mirror write / save-as failed", { sid, name }, e))
  }, [])

  const value: ArtifactValue = {
    panelOpen,
    setPanelOpen,
    activeEntry,
    setActiveEntry,
    previewNonce,
    liveCode,
    artifactSession,
    onToolCall,
    openArtifactFromContent,
    downloadArtifactContent,
    resetPreview,
    syncCodeSession,
    syncChatSession,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
