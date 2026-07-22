import { afterEach, describe, expect, it, vi } from "vitest"
import { persistDuplicate, purgeProjectStorage } from "./projects"
import { saveStr, saveFiles } from "./projectContent"

// Regression cover for the third Bugbot finding on PR #125: duplicating a project performs TWO
// storage writes (the content copy, then the projects list) and either can fail. The second
// ordering is the nasty one — content copies fine, the list write fails, and storage is left
// holding Memory/Instructions/Files under an id that appears in no list. Nothing ever cleans
// that up, because only remove() deletes content and it cannot reach an id it cannot see.

interface StorageStub {
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
  removeItem: (k: string) => void
}

function installStorage(opts: { throwAfterSets?: number } = {}): Map<string, string> {
  const store = new Map<string, string>()
  let sets = 0
  const stub: StorageStub = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      if (opts.throwAfterSets !== undefined && sets >= opts.throwAfterSets) {
        const e = new Error("The quota has been exceeded.")
        e.name = "QuotaExceededError"
        throw e
      }
      sets += 1
      store.set(k, v)
    },
    removeItem: (k) => void store.delete(k),
  }
  ;(globalThis as { localStorage?: unknown }).localStorage = stub
  return store
}

const contentKeys = (store: Map<string, string>, id: string): string[] =>
  [...store.keys()].filter((k) => k.startsWith(`nightjar.project.${id}.`))

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe("persistDuplicate leaves storage clean on any failure", () => {
  it("copies content and writes the list on the happy path", () => {
    const store = installStorage()
    saveStr("src", "instructions", "be terse")
    const writeList = vi.fn(() => true)

    expect(persistDuplicate("src", "dst", writeList)).toBe(true)
    expect(writeList).toHaveBeenCalledTimes(1)
    expect(store.get("nightjar.project.dst.instructions")).toBe("be terse")
  })

  it("does not attempt the list write when the content copy fails", () => {
    // The source MUST be seeded, and the quota boundary must fall AFTER the seed write and
    // BEFORE the copy's first write. Seed nothing (or fail every write) and copyProjectContent
    // finds no parts to copy, trivially succeeds, and this test asserts nothing at all.
    installStorage({ throwAfterSets: 1 })
    saveStr("src", "instructions", "be terse") // write #1 — succeeds
    const writeList = vi.fn(() => true)

    expect(persistDuplicate("src", "dst", writeList)).toBe(false) // write #2 — throws
    // Ordering matters: writing the list first would leave a card with no content behind it.
    expect(writeList).not.toHaveBeenCalled()
  })

  it("REMOVES the copied content when the list write fails — no orphan under an unlisted id", () => {
    const store = installStorage()
    saveStr("src", "instructions", "be terse")
    saveStr("src", "memory", "remembers things")
    const writeList = vi.fn(() => false) // content copied fine; the list write is what failed

    expect(persistDuplicate("src", "dst", writeList)).toBe(false)
    expect(writeList).toHaveBeenCalledTimes(1)
    expect(contentKeys(store, "dst")).toEqual([]) // the whole point
    expect(contentKeys(store, "src")).toHaveLength(2) // source untouched
  })

  it("does not write the list when there is no content and the copy is a no-op", () => {
    installStorage() // nothing seeded
    const writeList = vi.fn(() => true)
    // With no content to copy the copy trivially succeeds, so the list write DOES run — this
    // guards the boundary the vacuous-test correction exposed: a no-content source is the happy
    // path, not the failure path.
    expect(persistDuplicate("src", "dst", writeList)).toBe(true)
    expect(writeList).toHaveBeenCalledTimes(1)
  })
})

// 5b PR-A: the single authoritative per-project delete fan-out must clear EVERY storage family,
// so a deleted project leaves nothing behind (the NJ-40/41 leak class). This is the one place
// the complete key set is asserted together — a future per-project key that forgets to join
// purgeProjectStorage would leave this test passing while leaking, so extend it alongside any
// new part.
describe("purgeProjectStorage clears every per-project storage family", () => {
  it("removes content, the chat session-id set, pins, unread, the cloud-consent flag AND auto-memory, touching no other project", () => {
    const store = installStorage()
    // Seed EVERY one of project p_1's families — content, session-id set, pinned, unread, consent.
    saveStr("p_1", "instructions", "x")
    saveStr("p_1", "memory", "y")
    saveFiles("p_1", [{ id: "f1", name: "a.md", content: "z" }])
    store.set("nightjar.sessionIds.chat.p_1", JSON.stringify(["s1"])) // the PR-B key
    store.set("nightjar.pinned.chat.p_1", JSON.stringify(["s1"])) // the chat-menu pin key
    store.set("nightjar.unread.chat.p_1", JSON.stringify(["s1"])) // the chat-menu unread key
    store.set("nightjar.project.p_1.cloudConsent", "1") // the 5b PR-C cloud-consent flag
    store.set("nightjar.project.p_1.autoMemory", "learned") // the AM-2a auto-memory (its own delete path)
    // ...and a bystander project + General history/pins/unread that must survive.
    saveStr("p_2", "instructions", "keep me")
    store.set("nightjar.sessionIds.chat", JSON.stringify(["general"]))
    store.set("nightjar.pinned.chat", JSON.stringify(["gpin"])) // General pins are NOT per-project
    store.set("nightjar.unread.chat", JSON.stringify(["gunread"])) // General unread is NOT per-project

    purgeProjectStorage("p_1")

    expect([...store.keys()].filter((k) => k.includes(".p_1"))).toEqual([])
    expect(store.get("nightjar.project.p_2.instructions")).toBe("keep me")
    expect(store.get("nightjar.sessionIds.chat")).toBe(JSON.stringify(["general"]))
    expect(store.get("nightjar.pinned.chat")).toBe(JSON.stringify(["gpin"])) // General pins untouched
    expect(store.get("nightjar.unread.chat")).toBe(JSON.stringify(["gunread"])) // General unread untouched
  })
})
