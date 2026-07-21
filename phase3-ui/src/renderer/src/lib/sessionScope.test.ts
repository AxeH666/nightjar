import { afterEach, describe, expect, it } from "vitest"
import {
  baseSlot,
  chatScope,
  deleteProjectSessionIds,
  displayChatTitle,
  loadProjectChatIds,
  projectOf,
  saveProjectChatIds,
  sessionIdsKey,
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

describe("project chat ids — the per-project history list's persistence", () => {
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

  it("round-trips an ordered list under the project's chat key, and deleteProjectSessionIds clears it", () => {
    const m = stub()
    expect(saveProjectChatIds("p_1", ["ses_new", "ses_old"])).toBe(true)
    expect(m.get("nightjar.sessionIds.chat.p_1")).toBe(JSON.stringify(["ses_new", "ses_old"]))
    expect(loadProjectChatIds("p_1")).toEqual(["ses_new", "ses_old"]) // order preserved (newest first)
    deleteProjectSessionIds("p_1")
    expect(loadProjectChatIds("p_1")).toEqual([])
  })

  it("returns [] for a project with no history, and on absent/garbage/non-array storage", () => {
    stub()
    expect(loadProjectChatIds("never_opened")).toEqual([])
    const ls = (globalThis as { localStorage: { setItem: (k: string, v: string) => void } }).localStorage
    ls.setItem("nightjar.sessionIds.chat.p_x", "{not json")
    expect(loadProjectChatIds("p_x")).toEqual([]) // garbage → []
    ls.setItem("nightjar.sessionIds.chat.p_y", JSON.stringify({ not: "an array" }))
    expect(loadProjectChatIds("p_y")).toEqual([]) // wrong shape → []
    ls.setItem("nightjar.sessionIds.chat.p_z", JSON.stringify(["ok", 42, null, "also"]))
    expect(loadProjectChatIds("p_z")).toEqual(["ok", "also"]) // filters non-strings defensively
    delete (globalThis as { localStorage?: unknown }).localStorage
    expect(loadProjectChatIds("p_1")).toEqual([]) // no storage at all
    expect(saveProjectChatIds("p_1", ["x"])).toBe(false)
  })
})

describe("displayChatTitle — a placeholder never shows as a raw timestamp", () => {
  it("maps engine placeholder / empty / legacy titles to 'New chat'", () => {
    expect(displayChatTitle("New Session 2026-07-21T01:23:44.123Z")).toBe("New chat")
    expect(displayChatTitle("2026-07-21T01:23:44.123Z")).toBe("New chat")
    expect(displayChatTitle("")).toBe("New chat")
    expect(displayChatTitle("   ")).toBe("New chat")
    expect(displayChatTitle(null)).toBe("New chat")
    expect(displayChatTitle(undefined)).toBe("New chat")
    expect(displayChatTitle("June chat")).toBe("New chat") // legacy forced default (new chats)
    expect(displayChatTitle("June session")).toBe("New chat") // legacy forced default (connection primary)
  })

  it("passes through a real, engine-generated title untouched", () => {
    expect(displayChatTitle("Token efficiency optimization")).toBe("Token efficiency optimization")
    expect(displayChatTitle("  Fix the CSP frame-src  ")).toBe("Fix the CSP frame-src") // trimmed
  })
})

