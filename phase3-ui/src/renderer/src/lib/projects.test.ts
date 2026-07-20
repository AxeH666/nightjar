import { afterEach, describe, expect, it, vi } from "vitest"
import { persistDuplicate } from "./projects"
import { saveStr } from "./projectContent"

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
})
