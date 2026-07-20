import { beforeEach, describe, expect, it, vi } from "vitest"
import { isStorageHealthy, reportStorageWrite, subscribeStorageHealth } from "./storageHealth"

// Regression cover for the Bugbot finding on PR #125: storage health was component state, so
// navigating Projects home ⇄ an open project remounted the hook and silently reset the
// "Changes not being saved" warning to healthy while storage was still broken.
//
// The point of these tests is that the flag is MODULE-scoped and survives consumers coming and
// going. Each test re-establishes the healthy baseline explicitly rather than relying on a
// test-only reset hatch, so they are order-independent.
beforeEach(() => {
  reportStorageWrite(true)
})

describe("storage health is shared, not per-component", () => {
  it("reportStorageWrite returns its argument so it can wrap a write inline", () => {
    expect(reportStorageWrite(true)).toBe(true)
    expect(reportStorageWrite(false)).toBe(false)
  })

  it("a failure is visible to a consumer that subscribes AFTERWARDS (the remount case)", () => {
    reportStorageWrite(false) // fails while, say, ProjectsHome is mounted
    // ProjectView mounts later and must inherit the broken state, not a fresh "healthy".
    expect(isStorageHealthy()).toBe(false)
  })

  it("unsubscribing one consumer does not reset the flag for the next one", () => {
    const first = vi.fn()
    const unsubscribe = subscribeStorageHealth(first)
    reportStorageWrite(false)
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

    reportStorageWrite(false)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)

    reportStorageWrite(false) // same value → no churn, so useSyncExternalStore doesn't re-render
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it("a later success clears the warning — storage really is working again", () => {
    reportStorageWrite(false)
    expect(isStorageHealthy()).toBe(false)
    reportStorageWrite(true)
    expect(isStorageHealthy()).toBe(true)
  })
})
