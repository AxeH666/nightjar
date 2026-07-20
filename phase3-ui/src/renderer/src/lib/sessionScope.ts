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
// PR-B will make SessionsContext consume `sessionIdsKey` from HERE (single source of truth) so
// the General keys below cannot drift from the ones it writes today. Until then, the test in
// sessionScope.test.ts pins the exact current strings as the zero-migration contract.

export type BaseSlot = "chat" | "code" | "cad"

// A scope is either a base slot (General space) or a project-scoped chat. Only chat is
// project-scoped in 5b; code/cad have no project form.
export type SlotScope = BaseSlot | `chat::${string}`

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

// A project has a SINGLE persistent chat (5b decision), so its "session-id set" holds exactly
// one id. Stored the same shape as loadSessionIds/persistSessionIds (a JSON string[]) under the
// same key, so deleteProjectSessionIds clears it — one key family, one delete path.
export function loadProjectChatId(projectId: string): string | null {
  try {
    const raw = localStorage.getItem(sessionIdsKey(chatScope(projectId)))
    const arr = raw ? (JSON.parse(raw) as string[]) : []
    return arr[0] ?? null
  } catch {
    return null
  }
}

export function saveProjectChatId(projectId: string, sessionId: string): boolean {
  try {
    localStorage.setItem(sessionIdsKey(chatScope(projectId)), JSON.stringify([sessionId]))
    return true
  } catch {
    return false
  }
}

// When reopening a project chat, decide whether to REUSE the persisted session id or discard it
// and create a fresh one. `listedIds` is the engine's current session ids, or `null` if that
// check itself FAILED (transient network/API error).
//
// The rule that matters (Bugbot): only a SUCCESSFUL listing that OMITS the id proves the session
// is gone. A failed check (`null`) must NOT be treated as death — otherwise a transient blip
// would create a new session and permanently repoint the project away from a still-live
// conversation. So: reuse when there's no listing to contradict us; create only on proof of death.
export function shouldReuseStoredChat(stored: string | null, listedIds: string[] | null): boolean {
  if (!stored) return false
  if (listedIds === null) return true // couldn't verify → reuse optimistically, never repoint on a blip
  return listedIds.includes(stored)
}
