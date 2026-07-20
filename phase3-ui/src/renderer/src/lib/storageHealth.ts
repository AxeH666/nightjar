import { useSyncExternalStore } from "react"

// Whether the browser storage backing Projects is actually accepting writes.
//
// This deliberately lives at MODULE scope rather than in component state. Storage health is a
// property of the origin — not of a component, a project, or a lab scope. `useProjects` and
// `useProjectContent` are mounted and unmounted by ordinary navigation (Projects home ⇄ an
// open project), so per-component state would re-initialize to "healthy" on the next remount
// and silently clear the "Changes not being saved" warning while storage was still broken.
//
// That failure mode is the whole reason this module exists: a warning that quietly resets is
// the same false-success the save indicator was built to eliminate, just one level up. Caught
// by Bugbot on PR #125.
let healthy = true
const listeners = new Set<() => void>()

export function isStorageHealthy(): boolean {
  return healthy
}

export function subscribeStorageHealth(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

// Record the real outcome of a storage write. Returns `ok` unchanged so callers can wrap a
// write expression inline: `noteSave(part, reportStorageWrite(saveStr(...)))`.
//
// A later SUCCESS clears the warning: if the user frees space, storage genuinely is working
// again and saying otherwise would be its own inaccuracy.
export function reportStorageWrite(ok: boolean): boolean {
  if (healthy !== ok) {
    healthy = ok
    for (const notify of listeners) notify()
  }
  return ok
}

// Subscribes to the module-level flag, so every mounted consumer agrees and a remount inherits
// the current truth instead of resetting it.
export function useStorageHealthy(): boolean {
  return useSyncExternalStore(subscribeStorageHealth, isStorageHealthy, isStorageHealthy)
}
