import { describe, test, expect } from "vitest"

// NJ-71: the voice status must not claim an open microphone when none is open.
//
// Confirmed on hardware 2026-08-05: the wake daemon crash-looped to `failed` while the
// persisted pref stayed `true`, and the orb rendered a confident "mic on" with nothing
// listening. `stillListening` did not catch it — that fires only on state `stopped` WITH the
// still-listening marker, and a crash-looped daemon is `failed`.
//
// The important part: pushing the status MORE OFTEN would not have fixed this. `enabled` is
// derived purely from the pref, so more frequent delivery just repeats the same lie on a
// shorter interval. The status needs a second field sourced from the SUPERVISOR.
//
// This mirrors voiceStatusNow()'s derivation (src/main/index.ts) without importing it —
// index.ts pulls in `electron` and the whole service graph at module load, so it cannot be
// imported headlessly. The rule under test is the state->boolean mapping.

type ServiceState =
  | "pending" | "starting" | "healthy" | "unhealthy" | "restarting" | "stopped" | "failed" | "adopted"

const STILL_LISTENING_MARKER = "STILL listening"

/** The derivation under test, kept in step with voiceStatusNow(). */
function deriveVoiceStatus(pref: boolean, svc?: { state: ServiceState; detail?: string }) {
  return {
    enabled: pref,
    running: svc?.state === "healthy" || svc?.state === "adopted",
    starting: svc?.state === "pending" || svc?.state === "starting" || svc?.state === "restarting",
    stillListening: Boolean(svc?.state === "stopped" && svc.detail?.includes(STILL_LISTENING_MARKER)),
  }
}

/** What the orb/settings render from a status — "mic on" requires BOTH. */
const claimsMicOpen = (s: { enabled: boolean; running: boolean }) => s.enabled && s.running

/**
 * The label the UI shows. Bugbot PR #158: `enabled && !running` is NOT automatically a
 * failure — the daemon passes through pending/starting on the way up, and its readiness
 * window is the supervisor default of 90 SECONDS. Reporting that as "voice failed" would
 * slander every normal enable for a minute and a half, looking exactly like the crash this
 * PR fixes.
 */
function label(s: { enabled: boolean; running: boolean; starting: boolean }) {
  if (!s.enabled) return "voice off"
  if (s.running) return "mic on"
  return s.starting ? "starting" : "voice failed"
}

describe("voice status honesty (NJ-71)", () => {
  test("THE HARDWARE CASE: pref on + daemon failed must NOT claim an open mic", () => {
    const s = deriveVoiceStatus(true, { state: "failed", detail: "exited (code 1); restarts exhausted" })
    expect(s.enabled).toBe(true) // the user did opt in — that stays true
    expect(s.running).toBe(false) // but nothing is listening
    expect(claimsMicOpen(s)).toBe(false) // and the UI must not say otherwise
  })

  test("pref on + daemon healthy is the only ordinary way to claim an open mic", () => {
    const s = deriveVoiceStatus(true, { state: "healthy" })
    expect(claimsMicOpen(s)).toBe(true)
  })

  test("an ADOPTED daemon counts as running — it is a live capture process", () => {
    const s = deriveVoiceStatus(true, { state: "adopted" })
    expect(s.running).toBe(true)
    expect(claimsMicOpen(s)).toBe(true)
  })

  test("no transient or dead state ever claims an open mic", () => {
    for (const state of ["pending", "starting", "restarting", "stopped", "failed", "unhealthy"] as ServiceState[]) {
      expect(claimsMicOpen(deriveVoiceStatus(true, { state }))).toBe(false)
    }
  })

  test("a missing service row is treated as not running, not as running", () => {
    expect(claimsMicOpen(deriveVoiceStatus(true, undefined))).toBe(false)
  })

  test("pref off never claims an open mic, whatever the daemon is doing", () => {
    for (const state of ["healthy", "adopted", "failed", "stopped"] as ServiceState[]) {
      expect(claimsMicOpen(deriveVoiceStatus(false, { state }))).toBe(false)
    }
  })

  test("the NJ-57 stuck-mic warning still fires and is separate from `running`", () => {
    const s = deriveVoiceStatus(false, { state: "stopped", detail: `port ${STILL_LISTENING_MARKER}` })
    expect(s.stillListening).toBe(true) // pref off, but something still holds the port
    expect(s.running).toBe(false) // not OUR managed process
    expect(claimsMicOpen(s)).toBe(false)
  })

  test("BUGBOT #158: a daemon coming up is 'starting', never 'voice failed'", () => {
    for (const state of ["pending", "starting", "restarting"] as ServiceState[]) {
      const s = deriveVoiceStatus(true, { state })
      expect(s.starting).toBe(true)
      expect(claimsMicOpen(s)).toBe(false) // still must not claim an open mic
      expect(label(s)).toBe("starting") // but must NOT cry failure
    }
  })

  test("only genuinely dead states read as 'voice failed'", () => {
    for (const state of ["failed", "unhealthy", "stopped"] as ServiceState[]) {
      expect(label(deriveVoiceStatus(true, { state }))).toBe("voice failed")
    }
    expect(label(deriveVoiceStatus(true, undefined))).toBe("voice failed")
  })

  test("the full enable sequence never passes through a false failure", () => {
    // The exact transition a normal voice-enable walks. If any step reads "voice failed",
    // the user sees an alarm during a working enable — and Test 1e would read as a failure.
    const walk = ["pending", "starting", "healthy"] as ServiceState[]
    const labels = walk.map((state) => label(deriveVoiceStatus(true, { state })))
    expect(labels).toEqual(["starting", "starting", "mic on"])
    expect(labels).not.toContain("voice failed")
  })

  test("a real crash still surfaces after the transient states", () => {
    const walk = ["pending", "starting", "failed"] as ServiceState[]
    expect(walk.map((state) => label(deriveVoiceStatus(true, { state })))).toEqual([
      "starting",
      "starting",
      "voice failed",
    ])
  })

  test("dedupe: only a real change is pushed", () => {
    // The supervisor callback fires on every transition of every service; re-pushing an
    // identical status would be pure noise. Serialized-value comparison is the guard.
    let last = ""
    const pushes: string[] = []
    const push = (s: object) => {
      const json = JSON.stringify(s)
      if (json === last) return
      last = json
      pushes.push(json)
    }
    push(deriveVoiceStatus(true, { state: "starting" }))
    push(deriveVoiceStatus(true, { state: "starting" })) // unrelated service moved — no change
    push(deriveVoiceStatus(true, { state: "healthy" })) // real change
    push(deriveVoiceStatus(true, { state: "healthy" }))
    push(deriveVoiceStatus(true, { state: "failed" })) // the daemon died — must be pushed
    expect(pushes.length).toBe(3)
    expect(JSON.parse(pushes[2]).running).toBe(false)
  })
})
