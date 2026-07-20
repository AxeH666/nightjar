import { useSyncExternalStore } from "react"

// Whether the browser storage backing Projects is accepting writes — tracked as the SET of
// currently-failing write keys, not a single boolean.
//
// Two reasons for the set rather than a flag:
//  1. Module scope, not component state. `useProjects`/`useProjectContent` are mounted and
//     unmounted by ordinary navigation (Projects home ⇄ an open project), so a per-component
//     flag would re-initialize to "healthy" on the next remount and silently clear the
//     "Changes not being saved" warning while storage was still broken. (Bugbot #1, PR #125.)
//  2. Per KEY, not one global bool. Storage failures are per-key: Files can hit quota while a
//     later one-character Memory edit — or a rename — succeeds. A single boolean let that
//     later success clear the banner while the failed panel still (correctly) showed
//     "Not saved". Keying means a success only clears ITS OWN key, so the banner stays up
//     until the thing that actually failed succeeds. (Bugbot #5, PR #125.)
//
// This is a stopgap consistent view over a deeper problem — `useProjects` is per-component
// state, so instances agree only through localStorage — tracked as NJ-41 for a store refactor.
const failingKeys = new Set<string>()
const listeners = new Set<() => void>()

export function isStorageHealthy(): boolean {
  return failingKeys.size === 0
}

export function subscribeStorageHealth(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

// Record the real outcome of a storage write under a stable key (e.g. `content:<pid>:files`,
// `projects:<scope>`). A success clears only that key; a failure adds it. Returns `ok` so a
// caller can wrap a write inline: `reportStorageWrite(key, saveStr(...))`.
export function reportStorageWrite(key: string, ok: boolean): boolean {
  const had = failingKeys.has(key)
  if (ok) failingKeys.delete(key)
  else failingKeys.add(key)
  if (had !== failingKeys.has(key)) {
    for (const notify of listeners) notify()
  }
  return ok
}

// Subscribes to the module-level set, so every mounted consumer agrees and a remount inherits
// the current truth instead of resetting it. True when NO key is currently failing.
export function useStorageHealthy(): boolean {
  return useSyncExternalStore(subscribeStorageHealth, isStorageHealthy, isStorageHealthy)
}
