// Pure decision for the connection status MESSAGE shown while (re)connecting to opencode-serve.
// Extracted from ConnectionContext so it's unit-testable without React/timers. The connect loop
// retries forever (correct — the engine may be a slow cold start); this only chooses what to SAY,
// so an eternal optimistic "still starting…" becomes an honest terminal-ish message once the
// supervisor has marked the engine failed, or ~90s of no connection has elapsed (audit1.md P2-8).

// ~2s per attempt in the connect loop, so attempt 45 ≈ 90s. Past that, stop claiming "still
// starting" and point the user at the diagnostics.
export const SLOW_ATTEMPTS = 45

export function connectingHint(
  attempt: number,
  opencodeState: string | undefined,
  opencodeDetail: string | undefined,
): string {
  // The supervisor gave up on the engine → this is NOT a slow cold start. Say so, and point at the
  // Services strip / setup rather than looping the optimistic message forever.
  if (opencodeState === "failed") {
    return (
      "The engine (opencode-serve) failed to start" +
      (opencodeDetail ? ` — ${opencodeDetail}` : "") +
      ". Check the Services strip below, or re-run setup. Retrying…"
    )
  }
  if (attempt < 3) return "starting the local engine…"
  if (attempt < SLOW_ATTEMPTS) return "still starting the local engine — the model can take a minute on first launch…"
  return "The engine still isn't responding after ~90s — check the Services strip below (likely an engine or setup problem). Still retrying…"
}
