// Session scoping for 5b (per-project chat isolation). PURE module — no React, no
// SessionsContext import — so the projects store can use its delete-hygiene helpers without
// pulling the heavy session context, and so the key math is unit-testable in isolation.
//
// The model (5b design, PR-A of 3): a chat session belongs to a SCOPE. The "General" scope is
// the no-project space and is keyed by the EXISTING localStorage keys verbatim, so a user's
// pre-5b history is General history with ZERO migration. A project chat is a separate scope,
// `chat::<projectId>`, that the connection's primary-adopt effect never touches — which is what
// dissolves the "no current project at adopt time" problem. In 5b only the chat slot becomes
// project-scoped; code/cad stay General.
//
// SessionsContext consumes `sessionIdsKey` from HERE (single source of truth), so the General
// keys below cannot drift from the ones it reads/writes. The test in sessionScope.test.ts pins the
// exact strings as the zero-migration contract.

export type BaseSlot = "chat" | "code" | "cad"

// A scope is either a base slot (General space) or a project-scoped chat. Only chat is
// project-scoped in 5b; code/cad have no project form.
export type SlotScope = BaseSlot | `chat::${string}`

// Where a chat can be re-filed by the ⋯ menu's Move (chat-menu PR-2): the General (no-project)
// space, or a specific project's chats. "Move" is a pure re-tag between the id-lists these scopes
// key — the engine session (its transcript) never moves — so this is the whole cross-scope model.
export type ChatMoveScope = { kind: "general" } | { kind: "project"; projectId: string }

// True when two move scopes are the same rail (so a Move onto the current scope is a no-op).
export function sameChatScope(a: ChatMoveScope, b: ChatMoveScope): boolean {
  if (a.kind === "general" && b.kind === "general") return true
  return a.kind === "project" && b.kind === "project" && a.projectId === b.projectId
}

// General (no-project) keys, kept BYTE-FOR-BYTE identical to SessionsContext.sessionIdsKey as
// it exists today (context/SessionsContext.tsx): code keeps its original "nightjar.codeSessionIds".
// Changing any of these strings silently orphans real users' recents — do not.
const GENERAL_KEY: Record<BaseSlot, string> = {
  code: "nightjar.codeSessionIds",
  chat: "nightjar.sessionIds.chat",
  cad: "nightjar.sessionIds.cad",
}

const CHAT_SCOPE_RE = /^chat::(.+)$/

// Compose the scope for a project's chat.
export function chatScope(projectId: string): `chat::${string}` {
  return `chat::${projectId}`
}

// The base slot a scope belongs to (a project chat resolves to "chat").
export function baseSlot(scope: SlotScope): BaseSlot {
  return CHAT_SCOPE_RE.test(scope) ? "chat" : (scope as BaseSlot)
}

// The projectId a scope is bound to, or null for the General (no-project) space.
export function projectOf(scope: SlotScope): string | null {
  const m = CHAT_SCOPE_RE.exec(scope)
  return m ? m[1] : null
}

// The localStorage key for a scope's session-id set. General reuses the EXISTING keys (zero
// migration); a project chat gets its own namespaced key so its history never mixes with
// General or another project.
export function sessionIdsKey(scope: SlotScope): string {
  const pid = projectOf(scope)
  return pid === null ? GENERAL_KEY[baseSlot(scope)] : `nightjar.sessionIds.chat.${pid}`
}

// Drop a project's chat session-id set. Called from the projects store's authoritative delete
// path (remove), so a deleted project doesn't leave its chat history under a key nothing
// references. Returns whether the removal actually landed (mirrors the projectContent
// save/delete helpers — a failed storage op must be reportable, not swallowed; see NJ-40).
export function deleteProjectSessionIds(projectId: string): boolean {
  try {
    localStorage.removeItem(sessionIdsKey(chatScope(projectId)))
    return true
  } catch {
    return false // storage blocked → the id set may linger; caller decides how to surface it
  }
}

// ── per-rail chat id-sets (chat-menu Pin + Unread) ──────────────────────────────
// Generic raw-key persistence for a per-rail Set<string> of chat ids. Both the Pin set and the
// Unread set use it — SessionList holds the RAW key as a prop (built via pinnedChatsKey /
// unreadChatsKey), so the storage mechanics live in one tolerant place (absent/garbage/non-array
// storage → empty set; a blocked write → false, reportable not swallowed).
export function loadIdSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [])
  } catch {
    return new Set()
  }
}
export function saveIdSet(key: string, ids: Set<string>): boolean {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]))
    return true
  } catch {
    return false
  }
}
// The per-rail localStorage keys. General chat uses the no-project form; a project uses its id. ONE
// builder each so the write (SessionList/ProjectChat) and the delete (purge) can't drift on the
// format. Both are per-project key families, so they MUST be in purgeProjectStorage.
export function pinnedChatsKey(projectId?: string): string {
  return projectId ? `nightjar.pinned.chat.${projectId}` : "nightjar.pinned.chat"
}
export function unreadChatsKey(projectId?: string): string {
  return projectId ? `nightjar.unread.chat.${projectId}` : "nightjar.unread.chat"
}
// Drop a project's pinned / unread keys. Both join purgeProjectStorage's fan-out — the NJ-40/41 leak
// class is exactly a per-project key family a delete path forgot (the pin key was one such miss).
export function deleteProjectPins(projectId: string): boolean {
  try {
    localStorage.removeItem(pinnedChatsKey(projectId))
    return true
  } catch {
    return false
  }
}
export function deleteProjectUnread(projectId: string): boolean {
  try {
    localStorage.removeItem(unreadChatsKey(projectId))
    return true
  } catch {
    return false
  }
}

// A project has MANY chats (its history rail), stored NEWEST-FIRST as a JSON string[] under the
// same key loadSessionIds/persistSessionIds use — so deleteProjectSessionIds still clears the
// whole family in one delete path.
export function loadProjectChatIds(projectId: string): string[] {
  try {
    const raw = localStorage.getItem(sessionIdsKey(chatScope(projectId)))
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : []
  } catch {
    return []
  }
}

export function saveProjectChatIds(projectId: string, ids: string[]): boolean {
  try {
    localStorage.setItem(sessionIdsKey(chatScope(projectId)), JSON.stringify(ids))
    return true
  } catch {
    return false
  }
}

// The engine (OpenCode) gives a brand-new session a placeholder title — a prefix + ISO timestamp
// — and replaces it with a real, conversation-derived title after the first message
// (session/prompt.ts ensureTitle, gated on isDefaultTitle). Map anything still on a placeholder
// (or empty, or a legacy forced default like "June chat"/"June coding") to a friendly "New chat"
// so the rail never shows a raw timestamp while a chat is waiting to be auto-titled.
// The engine's placeholder is a FULL match on `<prefix><ISO timestamp>` (from OpenCode
// session/session.ts isDefaultTitle: prefixes "New session - " / "Child session - "). Anchor to
// the whole string — a suffix match would mis-hide a real title that merely ENDS with a timestamp
// (Bugbot). Keep these in sync if the engine's prefixes change.
const PLACEHOLDER_TITLE = /^(New session - |Child session - )\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
// Legacy forced titles Nightjar used before auto-titling: "June chat" (new chats) + "June session"
// (the connection primary) for the chat slot, plus "June coding" (code slot) + "June CAD" (cad
// slot). The latter two were dropped from createSession so code/cad also engine-auto-title, but
// sessions created before that fix — and the in-memory rebind/resume fallback (DEFAULT_TITLE) —
// still carry them, so they must mask to "New chat" too. All four are placeholders, not
// user-chosen names.
const LEGACY_DEFAULTS = new Set(["June chat", "June session", "June coding", "June CAD"])
// The label shown for an as-yet-unnamed chat. Exported so the rename UI can detect it (and start
// blank on it) without hard-coding the string in a second place (consistency sweep).
export const NEW_CHAT_LABEL = "New chat"
export function displayChatTitle(title: string | undefined | null): string {
  const t = (title ?? "").trim()
  return !t || PLACEHOLDER_TITLE.test(t) || LEGACY_DEFAULTS.has(t) ? NEW_CHAT_LABEL : t
}

