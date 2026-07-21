import { afterEach, describe, expect, it } from "vitest"
import {
  saveStr,
  saveFiles,
  copyProjectContent,
  deleteProjectContent,
  hasCloudConsent,
  allowCloudConsent,
  deleteProjectConsent,
  buildProjectSystem,
  hasProjectContext,
} from "./projectContent"

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

// `throwOnSet` fails every write; `throwAfterSets: n` succeeds n writes then fails, which is
// how a real quota failure hits a multi-part copy — partway through, not at the start.
function installStorage(opts: { throwOnSet?: boolean; throwAfterSets?: number } = {}): Map<string, string> {
  const store = new Map<string, string>()
  let sets = 0
  const stub: StorageStub = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      const overLimit = opts.throwAfterSets !== undefined && sets >= opts.throwAfterSets
      if (opts.throwOnSet || overLimit) {
        // Shape-accurate: browsers throw a DOMException named QuotaExceededError.
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

// Regression cover for the second Bugbot finding on PR #125: copyProjectContent swallowed its
// exception, so a duplicate could appear with none of its content carried across.
describe("duplicate/delete report their real outcome", () => {
  it("copyProjectContent carries every part and reports success", () => {
    const store = installStorage()
    saveStr("src", "instructions", "be terse")
    saveStr("src", "memory", "remembers things")
    saveFiles("src", [{ id: "f_1", name: "spec.md", content: "hi" }])

    expect(copyProjectContent("src", "dst")).toBe(true)
    expect(store.get("nightjar.project.dst.instructions")).toBe("be terse")
    expect(store.get("nightjar.project.dst.memory")).toBe("remembers things")
    expect(store.get("nightjar.project.dst.files")).toBe(store.get("nightjar.project.src.files"))
  })

  it("reports FALSE and ROLLS BACK when the copy fails partway (quota mid-copy)", () => {
    // 3 writes seed the source, the 4th is the copy's FIRST part (which must succeed), and the
    // 5th throws. That is the case that matters: one part across, then quota. Getting this
    // boundary wrong makes the test vacuous — at 3 the copy dies on its first write, nothing is
    // ever partially written, and the orphan assertion passes with or without the rollback.
    const store = installStorage({ throwAfterSets: 4 })
    saveStr("src", "instructions", "be terse")
    saveStr("src", "memory", "remembers things")
    saveFiles("src", [{ id: "f_1", name: "spec.md", content: "hi" }])

    expect(copyProjectContent("src", "dst")).toBe(false)

    // No half-populated duplicate left behind.
    const orphans = [...store.keys()].filter((k) => k.startsWith("nightjar.project.dst."))
    expect(orphans).toEqual([])
    // ...and the source is untouched.
    expect(store.get("nightjar.project.src.instructions")).toBe("be terse")
  })

  it("deleteProjectContent removes every part and reports success", () => {
    const store = installStorage()
    saveStr("p_1", "instructions", "x")
    saveStr("p_1", "memory", "y")
    expect(deleteProjectContent("p_1")).toBe(true)
    expect([...store.keys()].filter((k) => k.startsWith("nightjar.project.p_1."))).toEqual([])
  })

  it("deleteProjectContent reports FALSE when storage is absent — content may linger", () => {
    expect(deleteProjectContent("p_1")).toBe(false)
  })
})

// The gated project-context assembly (5b PR-C: Instructions; AM-1: + Memory) + its per-project cloud
// consent. buildProjectSystem is the safety invariant — private knowledge must never reach a cloud
// model without consent — so it is asserted directly (assert-then-mutate: flip any input, it withholds).
describe("gated project-context injection (Instructions + Memory)", () => {
  it("buildProjectSystem: attaches labelled knowledge only when LOCAL or CONSENTED", () => {
    // Local model → attach whatever knowledge exists (no egress), labelled per section.
    expect(buildProjectSystem({ instructions: "be terse", memory: "prefers TS", isLocal: true, consent: false })).toBe(
      "Project instructions:\nbe terse\n\nProject memory:\nprefers TS",
    )
    // Cloud + consent → attach (the user opted this project in).
    expect(buildProjectSystem({ instructions: "be terse", memory: "", isLocal: false, consent: true })).toBe("Project instructions:\nbe terse")
    // Cloud + NO consent → withhold ALL of it (the safety invariant), even though knowledge exists.
    expect(buildProjectSystem({ instructions: "be terse", memory: "prefers TS", isLocal: false, consent: false })).toBeUndefined()
    // Only one part present → only that section (no empty/dangling label).
    expect(buildProjectSystem({ instructions: "", memory: "prefers TS", isLocal: true, consent: false })).toBe("Project memory:\nprefers TS")
    // No knowledge at all → undefined regardless of model/consent (nothing to send).
    expect(buildProjectSystem({ instructions: "", memory: "   ", isLocal: true, consent: true })).toBeUndefined() // whitespace-only = empty
  })

  it("hasProjectContext: true when EITHER Instructions or Memory has content", () => {
    expect(hasProjectContext({ instructions: "x", memory: "" })).toBe(true)
    expect(hasProjectContext({ instructions: "", memory: "y" })).toBe(true)
    expect(hasProjectContext({ instructions: "", memory: "   " })).toBe(false) // both empty/whitespace → nothing to gate
  })

  it("cloud consent defaults to false and round-trips through storage", () => {
    const store = installStorage()
    expect(hasCloudConsent("p_1")).toBe(false) // default: private knowledge stays put
    expect(allowCloudConsent("p_1")).toBe(true)
    expect(hasCloudConsent("p_1")).toBe(true)
    expect(store.get("nightjar.project.p_1.cloudConsent")).toBe("1")
  })

  it("deleteProjectConsent clears the flag (so a re-created id doesn't inherit stale consent)", () => {
    const store = installStorage()
    allowCloudConsent("p_1")
    expect(deleteProjectConsent("p_1")).toBe(true)
    expect(hasCloudConsent("p_1")).toBe(false)
    expect(store.has("nightjar.project.p_1.cloudConsent")).toBe(false)
  })

  it("hasCloudConsent is false when storage is absent rather than throwing", () => {
    expect(hasCloudConsent("p_1")).toBe(false)
  })
})
