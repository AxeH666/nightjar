import { afterEach, describe, expect, it } from "vitest"
import { saveStr, saveFiles } from "./projectContent"

// These tests exist for ONE reason: the Projects UI shows a "Saved" indicator, and an
// indicator wired to an assumed success is worse than no indicator — it would report "Saved"
// for writes that silently failed. So the write helpers must report their REAL outcome, and
// the failure path is the one that has to be proven, not the happy path.
//
// The real-world trigger is QuotaExceededError: localStorage has a ~5MB per-origin cap, and
// pasting a large reference into a project's Files is a realistic way to hit it.

interface StorageStub {
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
  removeItem: (k: string) => void
}

function installStorage(opts: { throwOnSet?: boolean } = {}): Map<string, string> {
  const store = new Map<string, string>()
  const stub: StorageStub = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      if (opts.throwOnSet) {
        // Shape-accurate: browsers throw a DOMException named QuotaExceededError.
        const e = new Error("The quota has been exceeded.")
        e.name = "QuotaExceededError"
        throw e
      }
      store.set(k, v)
    },
    removeItem: (k) => void store.delete(k),
  }
  ;(globalThis as { localStorage?: unknown }).localStorage = stub
  return store
}

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe("project content persistence reports real outcomes", () => {
  it("saveStr returns true and the value round-trips when the write lands", () => {
    const store = installStorage()
    expect(saveStr("p_1", "instructions", "be terse")).toBe(true)
    expect(store.get("nightjar.project.p_1.instructions")).toBe("be terse")
  })

  it("saveStr returns FALSE when the write throws (quota exceeded) — the failure is not swallowed", () => {
    installStorage({ throwOnSet: true })
    expect(saveStr("p_1", "instructions", "be terse")).toBe(false)
  })

  it("saveFiles returns true on success and serializes the list", () => {
    const store = installStorage()
    const files = [{ id: "f_1", name: "spec.md", content: "hello" }]
    expect(saveFiles("p_1", files)).toBe(true)
    expect(JSON.parse(store.get("nightjar.project.p_1.files") ?? "null")).toEqual(files)
  })

  it("saveFiles returns FALSE when the write throws — a large pasted reference must not look saved", () => {
    installStorage({ throwOnSet: true })
    expect(saveFiles("p_1", [{ id: "f_1", name: "big.md", content: "x".repeat(1000) }])).toBe(false)
  })

  it("returns FALSE when localStorage is entirely absent rather than throwing", () => {
    // No storage installed at all — the guard must degrade honestly, not crash the renderer
    // and not claim success.
    expect(saveStr("p_1", "memory", "note")).toBe(false)
    expect(saveFiles("p_1", [])).toBe(false)
  })
})
