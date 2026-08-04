// Which service states a MANUAL restart is offered for — one definition, shared by the
// renderer (which decides whether to render the button) and the main process (which decides
// whether to honour the request).
//
// Why this file exists (NJ-66): the rule used to live only in HealthStrip.tsx, as a Set
// consulted in JSX. `ipcMain.handle("nightjar:restart", …)` honoured any name in any state,
// so the "only when failed/unhealthy" rule was a property of one React component, not of the
// API. Anything else holding the preload bridge — DevTools, a future in-tree caller — simply
// did not have the rule. This is a CONSISTENCY fix: the UI's rule should also be the API's.
//
// It is deliberately NOT sold as a security boundary. A renderer-side caller that wants to
// bounce a healthy engine still can, via `capabilities:setBulk({})` → restartService, which
// restarts opencode-serve unconditionally (see NJ-67). Closing that is a separate, larger
// change to the capability/BYOK apply paths and is not attempted here.
//
// LOCATION MATTERS: this lives in src/shared, not src/main. tsconfig.web.json is
// `composite: true` with `include: ["src/renderer/**/*"]`, so a renderer file importing from
// src/main fails `npm run typecheck` with TS6307 ("not listed within the file list of
// project"), and a vite alias does not fix it — it is a tsc project-graph error, not a
// bundler resolution one. Both tsconfigs include "src/shared/**/*" so either side may import
// this. Keep this file dependency-free (no electron, no node builtins) so it stays importable
// from both.

// Mirrors ServiceState in src/main/supervisor.ts. Kept as a plain string union rather than
// importing that type, because importing from src/main is exactly what TS6307 forbids.
export type RestartableState =
  | "pending"
  | "starting"
  | "healthy"
  | "unhealthy"
  | "restarting"
  | "stopped"
  | "failed"
  | "adopted"

// The supervisor already auto-restarts a crashing service; a manual restart is for when it
// has given up (`failed`) or is wedged answering nothing (`unhealthy`). Every other state is
// either transient (pending/starting/restarting — wait for it), deliberate (stopped — e.g. a
// wake-daemon with voice off, which must be started through its own consent path, not here),
// or working (healthy/adopted).
export const RESTARTABLE_STATES: readonly RestartableState[] = ["failed", "unhealthy"] as const

export function canRestart(state: string): boolean {
  return (RESTARTABLE_STATES as readonly string[]).includes(state)
}
