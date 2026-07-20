import { afterEach, describe, expect, it } from "vitest"
import {
  baseSlot,
  chatScope,
  deleteProjectSessionIds,
  loadProjectChatId,
  projectOf,
  saveProjectChatId,
  sessionIdsKey,
  shouldReuseStoredChat,
} from "./sessionScope"

// The load-bearing test for 5b's migration safety: the General (no-project) keys MUST equal the
// exact strings SessionsContext.sessionIdsKey produces today, or a real user's recents rail
// silently empties on upgrade. These literals are copied verbatim from
// context/SessionsContext.tsx (`slot === "code" ? "nightjar.codeSessionIds" :
// `nightjar.sessionIds.${slot}``) and are the contract PR-B must keep when it unifies the two.
const LEGACY_KEYS = {
  code: "nightjar.codeSessionIds",
  chat: "nightjar.sessionIds.chat",
  cad: "nightjar.sessionIds.cad",
} as const

describe("General scope reuses the existing keys (zero migration)", () => {
  it("produces byte-identical keys to today's SessionsContext for every base slot", () => {
    expect(sessionIdsKey("code")).toBe(LEGACY_KEYS.code)
    expect(sessionIdsKey("chat")).toBe(LEGACY_KEYS.chat)
    expect(sessionIdsKey("cad")).toBe(LEGACY_KEYS.cad)
  })
})

describe("project chat scope is separate and round-trips", () => {
  it("namespaces a project's chat key under its id, distinct from General", () => {
    expect(sessionIdsKey(chatScope("p_abc"))).toBe("nightjar.sessionIds.chat.p_abc")
    expect(sessionIdsKey(chatScope("p_abc"))).not.toBe(sessionIdsKey("chat"))
  })

  it("baseSlot resolves a project chat to 'chat' and leaves base slots unchanged", () => {
    expect(baseSlot(chatScope("p_1"))).toBe("chat")
    expect(baseSlot("chat")).toBe("chat")
    expect(baseSlot("code")).toBe("code")
    expect(baseSlot("cad")).toBe("cad")
  })

  it("projectOf extracts the id for a project chat and is null for the General space", () => {
    expect(projectOf(chatScope("p_1"))).toBe("p_1")
    expect(projectOf("chat")).toBeNull()
    expect(projectOf("code")).toBeNull()
  })

  it("handles ids containing separators without collapsing the scope", () => {
    // Project ids are p_<base36>_<seq>, but guard against an id that itself contains a colon.
    const weird = "p_x::y"
    expect(projectOf(chatScope(weird))).toBe(weird)
    expect(baseSlot(chatScope(weird))).toBe("chat")
  })
})

describe("deleteProjectSessionIds — the delete-hygiene helper", () => {
  const stub = (): Map<string, string> => {
    const m = new Map<string, string>()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    }
    return m
  }
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it("removes exactly the project's chat key and reports success", () => {
    const m = stub()
    m.set("nightjar.sessionIds.chat.p_1", JSON.stringify(["s1", "s2"]))
    m.set("nightjar.sessionIds.chat", JSON.stringify(["general"])) // General must be untouched
    expect(deleteProjectSessionIds("p_1")).toBe(true)
    expect(m.has("nightjar.sessionIds.chat.p_1")).toBe(false)
    expect(m.get("nightjar.sessionIds.chat")).toBe(JSON.stringify(["general"]))
  })

  it("returns FALSE when storage is absent rather than throwing", () => {
    // No localStorage installed — must degrade honestly, not crash the renderer.
    expect(deleteProjectSessionIds("p_1")).toBe(false)
  })
})

describe("project chat id — the single persistent chat's persistence (PR-B)", () => {
  const stub = (): Map<string, string> => {
    const m = new Map<string, string>()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    }
    return m
  }
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it("round-trips the id under the project's chat key, and deleteProjectSessionIds clears it", () => {
    const m = stub()
    expect(saveProjectChatId("p_1", "ses_abc")).toBe(true)
    expect(m.get("nightjar.sessionIds.chat.p_1")).toBe(JSON.stringify(["ses_abc"]))
    expect(loadProjectChatId("p_1")).toBe("ses_abc")
    // Same key family as the delete-hygiene helper → one delete path clears it.
    deleteProjectSessionIds("p_1")
    expect(loadProjectChatId("p_1")).toBeNull()
  })

  it("returns null for a project with no stored chat, and on absent/garbage storage", () => {
    stub()
    expect(loadProjectChatId("never_opened")).toBeNull()
    // Garbage value must not throw.
    ;(globalThis as { localStorage: { setItem: (k: string, v: string) => void } }).localStorage.setItem(
      "nightjar.sessionIds.chat.p_x",
      "{not json",
    )
    expect(loadProjectChatId("p_x")).toBeNull()
    delete (globalThis as { localStorage?: unknown }).localStorage
    expect(loadProjectChatId("p_1")).toBeNull() // no storage at all
    expect(saveProjectChatId("p_1", "x")).toBe(false)
  })
})

describe("shouldReuseStoredChat — never repoint on a transient list failure (Bugbot)", () => {
  it("reuses a stored id the engine still lists", () => {
    expect(shouldReuseStoredChat("ses_1", ["ses_1", "ses_2"])).toBe(true)
  })

  it("creates fresh only when a SUCCESSFUL listing proves the id is gone", () => {
    expect(shouldReuseStoredChat("ses_1", ["ses_2", "ses_3"])).toBe(false)
    expect(shouldReuseStoredChat("ses_1", [])).toBe(false) // empty list = engine has no sessions = dead
  })

  it("REUSES on a failed check (null) — a transient blip must not repoint the project", () => {
    // This is the whole point: null means listSessions itself failed, which is NOT proof of
    // death. Treating it as dead would create a new session and abandon a live conversation.
    expect(shouldReuseStoredChat("ses_1", null)).toBe(true)
  })

  it("never reuses when there is no stored id", () => {
    expect(shouldReuseStoredChat(null, ["ses_1"])).toBe(false)
    expect(shouldReuseStoredChat(null, null)).toBe(false)
  })
})
