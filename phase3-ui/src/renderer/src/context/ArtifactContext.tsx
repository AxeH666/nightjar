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
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { artifactActionFromTool, previewBridge } from "../lib/preview"
import type { ToolCall } from "../lib/opencode"
import { useConnection } from "./ConnectionContext"

// Prefer the newest .html as the active preview entry; otherwise the latest file.
const preferHtml = (prev: string, rel: string): string =>
  /\.html?$/i.test(rel) ? rel : /\.html?$/i.test(prev) ? prev : rel

interface LiveCode {
  rel: string
  content: string
  streaming: boolean
}

interface ArtifactValue {
  panelOpen: boolean
  setPanelOpen: (v: boolean) => void
  activeEntry: string
  setActiveEntry: (v: string) => void
  previewNonce: number
  liveCode: LiveCode | null
  // Mirror a coding-agent write/edit tool-call into the session sandbox + open the panel.
  onToolCall: (call: ToolCall, sessionID: string) => void
  // Drop all live-preview state. Called on any underlying-session change this
  // provider can't observe itself — notably a Code-tab session switch (CodeScreen);
  // this provider sits above SessionsContext and so never sees the code slot's id.
  resetPreview: () => void
}

const Ctx = createContext<ArtifactValue | null>(null)

export function useArtifact(): ArtifactValue {
  const v = useContext(Ctx)
  if (!v) throw new Error("useArtifact must be used within an ArtifactProvider")
  return v
}

export function ArtifactProvider({ children }: { children: ReactNode }) {
  const { sessionID } = useConnection()
  const [panelOpen, setPanelOpen] = useState(false)
  const [activeEntry, setActiveEntry] = useState<string>("")
  const [previewNonce, setPreviewNonce] = useState(0)
  const [liveCode, setLiveCode] = useState<LiveCode | null>(null)
  // callID → last mirrored content length, so we only re-mirror on growth/completion
  // (a tool part arrives repeatedly as pending→running→completed snapshots).
  const artifactSeen = useRef<Map<string, number>>(new Map())
  // The session the mirrored artifacts currently belong to. Tracked here (a ref,
  // set from the write path's sid) so a session change is detected synchronously
  // at mirror time — independent of the async `sessionID`-state reset effect below.
  const artifactSessionRef = useRef<string>("")
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
    artifactSeen.current.clear()
    artifactSessionRef.current = ""
  }, [])

  // Fresh connect or a reconnect (new primary session id) → reset. A Code-tab
  // session switch is NOT visible here (the code slot lives in SessionsContext,
  // below this provider); CodeScreen calls resetPreview() directly for that.
  useEffect(() => {
    resetPreview()
  }, [sessionID, resetPreview])

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
      if (artifactSeen.current.get(call.callID) === len) return
      artifactSeen.current.set(call.callID, len)
      const streaming = call.status !== "completed"
      setPanelOpen(true)
      if (action.kind === "write") {
        setLiveCode({ rel: action.filePath.split(/[\\/]/).pop() || action.filePath, content: action.content, streaming })
        pv.write(sid, action.filePath, action.content)
          .then(({ rel }) => {
            setActiveEntry((prev) => preferHtml(prev, rel))
            setLiveCode((lc) => (lc ? { ...lc, rel } : lc))
            bumpNonce()
          })
          .catch(() => {})
      } else {
        pv.edit(sid, action.filePath, action.oldString, action.newString, action.replaceAll)
          .then(({ rel }) => {
            setActiveEntry((prev) => preferHtml(prev, rel))
            bumpNonce()
          })
          .catch(() => {})
      }
    },
    [bumpNonce],
  )

  const value: ArtifactValue = {
    panelOpen,
    setPanelOpen,
    activeEntry,
    setActiveEntry,
    previewNonce,
    liveCode,
    onToolCall,
    resetPreview,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
