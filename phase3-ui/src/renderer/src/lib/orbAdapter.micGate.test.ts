import { describe, test, expect } from "vitest"
import { createNightjarOrbAdapter } from "./orbAdapter"

// NJ-63: the side-channel hub (ws://127.0.0.1:8765) has no auth and no origin check, and the
// renderer's orb adapter is permanently connected to it (the orb lives in the always-rendered
// header). Before this gate, a forged `{"kind":"wake"}` frame from ANY local process drove
// enterListening() → startMic() → getUserMedia({audio:true}) with nothing consulting the
// user's voice preference — a second mic-open path entirely around PR #151's consent gate,
// which governs the wake-daemon PROCESS, not the renderer's own mic handle.
//
// These drive the REAL adapter with an injected socket + instrumented getUserMedia, which is
// what its injectable-deps design exists for. They are NOT a substitute for confirming on
// hardware that the OS mic indicator stays dark (rule 8) — that check is in the PR body.

interface FakeSocket {
  readyState: number
  onopen: (() => void) | null
  onmessage: ((m: { data: string }) => void) | null
  onerror: (() => void) | null
  onclose: (() => void) | null
  sent: string[]
  send(s: string): void
  close(): void
}

function harness(micAllowed: () => boolean) {
  let sock: FakeSocket | null = null
  const micCalls: unknown[] = []

  const FakeWS = function (this: FakeSocket) {
    this.readyState = 1
    this.onopen = null
    this.onmessage = null
    this.onerror = null
    this.onclose = null
    this.sent = []
    this.send = (s: string) => void this.sent.push(s)
    this.close = () => {
      this.readyState = 3
    }
    sock = this
    // The adapter assigns its handlers synchronously after construction.
    setTimeout(() => this.onopen?.(), 0)
  } as unknown as typeof WebSocket

  const adapter = createNightjarOrbAdapter({
    url: "ws://127.0.0.1:8765",
    WebSocketImpl: FakeWS,
    micAllowed,
    getUserMedia: async (constraints: unknown) => {
      micCalls.push(constraints)
      return { getTracks: () => [{ stop() {}, readyState: "live" }] }
    },
    // Keep the analysers out of it — this test is about the mic decision, not audio levels.
    createAudioContext: () =>
      ({
        createAnalyser: () => ({ fftSize: 0, frequencyBinCount: 1, getByteFrequencyData: () => {} }),
        createMediaStreamSource: () => ({ connect: () => {} }),
        createMediaElementSource: () => ({ connect: () => {} }),
        destination: {},
        close: async () => {},
        state: "running",
        resume: async () => {},
      }) as never,
    // A no-op FrameScheduler: never actually fires, so the analyser loop stays inert and
    // the test observes only the mic DECISION, not audio plumbing.
    scheduler: { schedule: () => 0, cancel: () => {} },
  })

  const states: string[] = []
  const unsub = adapter.subscribe({
    onStateChange: (s) => void states.push(s),
    onVolumeChange: () => {},
  })

  const deliver = (event: Record<string, unknown>) =>
    sock?.onmessage?.({ data: JSON.stringify({ type: "event", event }) })

  return { adapter, deliver, micCalls, states, unsub }
}

const flush = () => new Promise((r) => setTimeout(r, 5))

describe("orb adapter mic gate (NJ-63)", () => {
  test("a forged wake frame does NOT open the mic when voice is disabled", async () => {
    const h = harness(() => false)
    h.deliver({ kind: "wake", detected: true })
    await flush()
    expect(h.micCalls.length).toBe(0)
    expect(h.adapter.getState()).toBe("idle") // and no listening state → no input-capturing overlay
    h.unsub()
  })

  test("a source-less wake frame is also refused (no fields to spoof around)", async () => {
    const h = harness(() => false)
    h.deliver({ kind: "wake" })
    await flush()
    expect(h.micCalls.length).toBe(0)
    h.unsub()
  })

  test("a legitimate wake still opens the mic when voice is enabled (no regression)", async () => {
    const h = harness(() => true)
    h.deliver({ kind: "wake", detected: true })
    await flush()
    expect(h.micCalls.length).toBe(1)
    expect(h.micCalls[0]).toEqual({ audio: true })
    expect(h.adapter.getState()).toBe("listening")
    h.unsub()
  })

  test("the gate is read live: flipping it off between frames takes effect", async () => {
    let on = true
    const h = harness(() => on)
    h.deliver({ kind: "wake", detected: true })
    await flush()
    expect(h.micCalls.length).toBe(1)

    // Back to idle, then the user turns voice off; the next wake must be refused.
    h.adapter.stop?.()
    on = false
    h.deliver({ kind: "wake", detected: true })
    await flush()
    expect(h.micCalls.length).toBe(1) // still 1 — the second wake opened nothing
    h.unsub()
  })

  // Bugbot PR #156 (Medium): the refusal must happen BEFORE any state change. If
  // enterListening() set 'listening' and started its timer first, discovering the refusal
  // inside startMic() would leave the orb claiming to listen — and VortexOverlay mounting
  // full-screen with pointer events live — for the whole 15s timeout, with no mic open.
  test("a refused wake changes NO state, so no overlay and no 15s timer (Bugbot #156)", async () => {
    const h = harness(() => false)
    h.deliver({ kind: "wake", detected: true })
    await flush()
    expect(h.micCalls.length).toBe(0)
    expect(h.adapter.getState()).toBe("idle")
    // The state stream must never have visited 'listening': VortexOverlay is driven by
    // `state !== "idle" && state !== "error"`, so a transient listening would flash the
    // input-capturing overlay over the whole app.
    expect(h.states).not.toContain("listening")
    h.unsub()
  })

  test("gating wake does NOT claim to close the transcription→overlay route (NJ-65)", async () => {
    // Documents a KNOWN residual so nobody reads the mic gate as closing it: a forged
    // `transcription` still drives 'connecting', which mounts the full-screen overlay.
    // The overlay is out of scope for this PR; this test pins the current behaviour so a
    // future change to it is deliberate rather than accidental.
    const h = harness(() => false)
    h.deliver({ kind: "transcription", text: "forged" })
    await flush()
    expect(h.micCalls.length).toBe(0) // no mic, at least
    expect(h.adapter.getState()).toBe("connecting") // but the state DOES change
    h.unsub()
  })
})
