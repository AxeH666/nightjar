import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import { OpenCodeClient } from "./opencode"

// audit1.md P2-5: NJ-20 bounded listAgents/createSession/abort/subscribe, but promptAsync and
// replyPermission (the safety-relevant POSTs) plus the history reads had NO wall-clock bound — a
// half-open socket wedges a send (busy stuck) / a permission reply / a history fetch forever. Each
// round-trip must now pass an AbortSignal (rule 3). This asserts the signal is wired (its presence
// is the regression guard; before the fix these fetches had no `signal`).
describe("OpenCodeClient rule-3 timeouts (P2-5)", () => {
  let calls: Array<{ url: string; opts: any }>
  beforeEach(() => {
    calls = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opts: any) => {
        calls.push({ url: String(url), opts })
        return {
          ok: true,
          status: 204,
          json: async () => ({ id: "s1" }),
          text: async () => "",
        } as unknown as Response
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  const client = new OpenCodeClient("http://127.0.0.1:4096")
  const sigOf = (needle: string) => {
    const c = calls.find((x) => x.url.includes(needle))
    expect(c, `expected a fetch to ${needle}`).toBeTruthy()
    return c!.opts?.signal
  }

  test("promptAsync bounds the POST with a live AbortSignal", async () => {
    await client.promptAsync("s1", "hi", "assistant")
    const s = sigOf("/prompt_async")
    expect(s).toBeInstanceOf(AbortSignal)
    expect(s.aborted).toBe(false)
  })
  test("replyPermission bounds the reply POST", async () => {
    await client.replyPermission("r1", "once")
    expect(sigOf("/permission/")).toBeInstanceOf(AbortSignal)
  })
  test("getMessages / listSessions / delete / rename are ALL bounded", async () => {
    await client.getMessages("s1")
    await client.listSessions()
    await client.deleteSession("s1")
    await client.renameSession("s1", "t")
    expect(calls.length).toBe(4)
    for (const c of calls) expect(c.opts?.signal, `signal missing for ${c.url}`).toBeInstanceOf(AbortSignal)
  })
})
