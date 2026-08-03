import { describe, test, expect, afterEach } from "vitest"
import { wakeDaemonEnv } from "./services"

// Voice-phase PR 2: the wake daemon's env overlay — voice turns must follow the CHAT
// pref (a Cloud user's voice turns were silently running on the local 4B), and the
// PR-5 wake-model path must pass through without daemon code changes.
describe("wakeDaemonEnv (voice-phase PR 2)", () => {
  const saved = process.env.NIGHTJAR_WAKEWORD_MODEL
  afterEach(() => {
    if (saved === undefined) delete process.env.NIGHTJAR_WAKEWORD_MODEL
    else process.env.NIGHTJAR_WAKEWORD_MODEL = saved
  })

  test("offline chat pref → no NIGHTJAR_MODEL (daemon's local default applies)", () => {
    const env = wakeDaemonEnv({ mode: "offline" })
    expect(env.NIGHTJAR_MODEL).toBeUndefined()
    expect(env.NIGHTJAR_DATA_DIR).toBeTruthy()
  })

  test("online chat pref → provider/model join (inner slashes preserved)", () => {
    const env = wakeDaemonEnv({ mode: "online", providerId: "openrouter", modelId: "meta-llama/llama-3.3-70b:free" })
    expect(env.NIGHTJAR_MODEL).toBe("openrouter/meta-llama/llama-3.3-70b:free")
  })

  test("a half-formed online pref (no model) falls back to the daemon default — never a guessed cloud route", () => {
    const env = wakeDaemonEnv({ mode: "online", providerId: "openai" })
    expect(env.NIGHTJAR_MODEL).toBeUndefined()
  })

  test("no pref at all → just the data dir (fresh install)", () => {
    const env = wakeDaemonEnv()
    expect(env.NIGHTJAR_MODEL).toBeUndefined()
    expect(env.NIGHTJAR_DATA_DIR).toBeTruthy()
  })

  test("an explicit NIGHTJAR_WAKEWORD_MODEL env wins and passes through", () => {
    process.env.NIGHTJAR_WAKEWORD_MODEL = "C:/custom/hey_june.onnx"
    const env = wakeDaemonEnv({ mode: "offline" })
    expect(env.NIGHTJAR_WAKEWORD_MODEL).toBe("C:/custom/hey_june.onnx")
  })
})
