#!/usr/bin/env bun
// Nightjar inference timeout proxy.
//
// Sits between OpenCode and the llama.cpp server and enforces a hard WALL-CLOCK
// timeout on every request — including mid-stream. This is the fix for the
// Phase 1.5 "stuck generation" hazard: a single model call that never completes
// (a repetition loop grinding toward the context limit, or a hung/slow crawl)
// is aborted at the deadline instead of running unbounded. The doom-loop guard
// only catches repeated *completed* calls; this catches one call that won't end.
//
// Streams responses through untouched (SSE token deltas pass straight to the
// client), so normal runs are unaffected. On timeout it aborts the upstream
// fetch (stopping generation on the server) and closes the client stream.
//
// Run:  bun inference-proxy.mjs
// Env:  NIGHTJAR_UPSTREAM (default http://127.0.0.1:8085)
//       NIGHTJAR_PROXY_PORT (default 8086)
//       NIGHTJAR_INFERENCE_TIMEOUT_MS (default 90000)

const UPSTREAM = process.env.NIGHTJAR_UPSTREAM || "http://127.0.0.1:8085"
const PORT = Number(process.env.NIGHTJAR_PROXY_PORT || 8086)
const TIMEOUT_MS = Number(process.env.NIGHTJAR_INFERENCE_TIMEOUT_MS || 90000)

console.error(`[nightjar-proxy] listening on :${PORT} -> ${UPSTREAM} (wall-clock timeout ${TIMEOUT_MS}ms)`)

// Progress oracle for the run-supervisor watchdog: count real generation
// requests (chat/completions, completions). A run that reaches the model
// increments this; a run frozen in session setup never does. Health/model-list
// probes are deliberately NOT counted, so they can't be mistaken for progress.
let genRequests = 0
let lastRequestAtMs = 0
const startedAtMs = Date.now()
const isGenerationPath = (p) => /\/(chat\/)?completions\/?$/.test(p)

Bun.serve({
  port: PORT,
  idleTimeout: 0, // disable Bun's own idle timeout; we enforce our own wall-clock
  async fetch(req) {
    const url = new URL(req.url)

    // Watchdog progress endpoint (served locally, not forwarded upstream).
    if (url.pathname === "/nightjar/stats") {
      return Response.json({ genRequests, lastRequestAtMs, uptimeMs: Date.now() - startedAtMs })
    }

    // Whether this is a generation request; we only count it as *progress* once
    // the upstream actually responds (below), not on arrival — a request that
    // hits the proxy but fails/times-out upstream never reached a working model,
    // so it must not advance the watchdog's "reached the model" counter.
    const isGen = isGenerationPath(url.pathname)

    const target = UPSTREAM + url.pathname + url.search

    // buffer the (small) request body so we don't need duplex streaming upstream
    const method = req.method
    const hasBody = method !== "GET" && method !== "HEAD"
    const body = hasBody ? await req.arrayBuffer() : undefined

    const ac = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      ac.abort()
    }, TIMEOUT_MS)
    const startedAt = performance.now()

    let upstream
    try {
      upstream = await fetch(target, { method, headers: req.headers, body, signal: ac.signal })
    } catch (e) {
      clearTimeout(timer)
      const ms = Math.round(performance.now() - startedAt)
      if (timedOut) {
        console.error(`[nightjar-proxy] TIMEOUT before headers on ${url.pathname} after ${ms}ms`)
        return json(504, `nightjar inference timeout after ${TIMEOUT_MS}ms (no response headers)`)
      }
      console.error(`[nightjar-proxy] upstream error on ${url.pathname}: ${e}`)
      return json(502, `nightjar proxy upstream error: ${String(e)}`)
    }

    // Upstream responded with headers → the model server was actually reached.
    // THIS is the "progress" signal the run-supervisor watchdog polls (not mere
    // request arrival), so a failed/hung-before-headers request doesn't fool it.
    if (isGen) {
      genRequests++
      lastRequestAtMs = Date.now()
    }

    // Non-streaming or bodyless: return as-is, clearing the timer.
    if (!upstream.body) {
      clearTimeout(timer)
      return new Response(null, { status: upstream.status, headers: upstream.headers })
    }

    // Stream through; clear the timer only when the stream finishes cleanly. If
    // the timer fires first, ac.abort() errors the upstream body → we surface a
    // timeout marker and close the client stream.
    const reader = upstream.body.getReader()
    const wrapped = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            clearTimeout(timer)
            controller.close()
            return
          }
          controller.enqueue(value)
        } catch (e) {
          clearTimeout(timer)
          const ms = Math.round(performance.now() - startedAt)
          if (timedOut) {
            console.error(`[nightjar-proxy] TIMEOUT mid-stream on ${url.pathname} after ${ms}ms — aborted generation`)
            // emit an SSE-style error frame so a streaming client ends cleanly
            try {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: {"error":{"message":"nightjar inference timeout after ${TIMEOUT_MS}ms"}}\n\ndata: [DONE]\n\n`,
                ),
              )
            } catch {}
            controller.close()
          } else {
            controller.error(e)
          }
        }
      },
      cancel() {
        clearTimeout(timer)
        ac.abort()
        reader.cancel().catch(() => {})
      },
    })

    return new Response(wrapped, { status: upstream.status, headers: upstream.headers })
  },
})

function json(status, message) {
  return new Response(JSON.stringify({ error: { message, type: "nightjar_proxy" } }), {
    status,
    headers: { "content-type": "application/json" },
  })
}
