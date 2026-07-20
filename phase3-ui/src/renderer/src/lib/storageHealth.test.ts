import { beforeEach, describe, expect, it, vi } from "vitest"
import { isStorageHealthy, reportStorageWrite, subscribeStorageHealth } from "./storageHealth"

// Regression cover for two Bugbot findings on PR #125:
//  - #1: storage health was component state, so navigating Projects home ⇄ an open project
//    remounted the hook and silently reset the "Changes not being saved" warning to healthy
//    while storage was still broken. Fixed by making it module-scoped.
//  - #5: health was a single boolean, so a later success on ANY key (a one-char Memory edit, a
//    rename) cleared the banner while a different part was still failing. Fixed by tracking the
//    SET of failing keys, so a success clears only its own key.
//
// Each test re-establishes a clean baseline explicitly rather than relying on a test-only reset
// hatch, so they are order-independent.
beforeEach(() => {
  // Clear whatever keys prior tests may have left failing.
  for (const k of ["a", "b", "content:p:files", "content:p:memory", "projects:general"]) {
    reportStorageWrite(k, true)
  }
})

describe("storage health is shared, not per-component", () => {
  it("reportStorageWrite returns its ok argument so it can wrap a write inline", () => {
    expect(reportStorageWrite("a", true)).toBe(true)
    expect(reportStorageWrite("a", false)).toBe(false)
    reportStorageWrite("a", true) // reset
  })

  it("a failure is visible to a consumer that subscribes AFTERWARDS (the remount case)", () => {
    reportStorageWrite("a", false) // fails while, say, ProjectsHome is mounted
    // ProjectView mounts later and must inherit the broken state, not a fresh "healthy".
    expect(isStorageHealthy()).toBe(false)
  })

  it("unsubscribing one consumer does not reset the flag for the next one", () => {
    const first = vi.fn()
    const unsubscribe = subscribeStorageHealth(first)
    reportStorageWrite("a", false)
    expect(first).toHaveBeenCalledTimes(1)

    unsubscribe() // component unmounts (navigation)
    expect(isStorageHealthy()).toBe(false) // still broken — this is the bug that was fixed

    const second = vi.fn()
    subscribeStorageHealth(second)
    expect(isStorageHealthy()).toBe(false) // the remounted consumer sees the truth
  })

  it("notifies every live subscriber on a change, and only on an actual change", () => {
    const a = vi.fn()
    const b = vi.fn()
    subscribeStorageHealth(a)
    subscribeStorageHealth(b)

    reportStorageWrite("a", false)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    reportStorageWrite("a", false) // same key still failing → no churn, so no re-render
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it("a later success clears the warning — when it is the SAME key that recovers", () => {
    reportStorageWrite("a", false)
    expect(isStorageHealthy()).toBe(false)
    reportStorageWrite("a", true)
    expect(isStorageHealthy()).toBe(true)
  })

  it("a success on a DIFFERENT key does NOT clear another key's failure (Bugbot #5)", () => {
    reportStorageWrite("content:p:files", false) // Files hit quota
    expect(isStorageHealthy()).toBe(false)

    // A one-character Memory edit succeeds; a rename succeeds. Neither touches the failing key.
    reportStorageWrite("content:p:memory", true)
    reportStorageWrite("projects:general", true)
    expect(isStorageHealthy()).toBe(false) // banner MUST stay up — Files is still memory-only

    reportStorageWrite("content:p:files", true) // the thing that actually failed recovers
    expect(isStorageHealthy()).toBe(true)
  })
})
