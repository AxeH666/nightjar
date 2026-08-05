import { describe, test, expect } from "vitest"
import { StringDecoder } from "node:string_decoder"

// NJ-80: the supervisor captures sidecar output with `data` chunks off a pipe. Chunk
// boundaries fall wherever the OS pipe buffer decides, so a multi-byte UTF-8 character can be
// split across two chunks. `b.toString()` decodes each chunk independently, so BOTH halves
// become U+FFFD and the log line is silently corrupted — intermittently, at a position that
// depends on buffering, which is why it would never show up in a test that writes one chunk.
//
// This pins the difference. It is a distinct defect from NJ-79: that was the PRODUCER writing
// cp1252 bytes; this is the CONSUMER mis-joining perfectly correct UTF-8.

// A line whose non-ASCII characters are exactly the ones the sidecars actually emit.
const LINE = "[wake-daemon] em-dash — ellipsis … box ─ warn ⚠ arrow →"

/** Split a buffer at `at`, mimicking an unlucky pipe-chunk boundary. */
function splitAt(buf: Buffer, at: number): [Buffer, Buffer] {
  return [buf.subarray(0, at), buf.subarray(at)]
}

describe("sidecar log decoding across chunk boundaries (NJ-80)", () => {
  const full = Buffer.from(LINE, "utf8")

  test("the naive per-chunk toString() corrupts a split character", () => {
    // Find a byte index that lands INSIDE a multi-byte character: a continuation byte
    // matches 0b10xxxxxx.
    const mid = full.findIndex((b, i) => i > 0 && (b & 0xc0) === 0x80)
    expect(mid).toBeGreaterThan(0)
    const [a, b] = splitAt(full, mid)
    const naive = a.toString() + b.toString()
    expect(naive).not.toBe(LINE)
    expect(naive).toContain("�") // the replacement character — visible corruption
  })

  test("a stateful StringDecoder reassembles it exactly", () => {
    const mid = full.findIndex((b, i) => i > 0 && (b & 0xc0) === 0x80)
    const [a, b] = splitAt(full, mid)
    const dec = new StringDecoder("utf8")
    const joined = dec.write(a) + dec.write(b)
    expect(joined).toBe(LINE)
    expect(joined).not.toContain("�")
  })

  test("it survives a split at EVERY byte offset, not just one lucky one", () => {
    for (let i = 1; i < full.length; i++) {
      const [a, b] = splitAt(full, i)
      const dec = new StringDecoder("utf8")
      expect(dec.write(a) + dec.write(b)).toBe(LINE)
    }
  })

  test("byte-at-a-time delivery (worst case) still reassembles", () => {
    const dec = new StringDecoder("utf8")
    let out = ""
    for (const byte of full) out += dec.write(Buffer.from([byte]))
    expect(out).toBe(LINE)
  })

  test("separate streams need separate decoders", () => {
    // stdout and stderr are independent byte streams. Sharing one decoder splices a partial
    // character from one into the other, which is why the fix creates two.
    const mid = full.findIndex((b, i) => i > 0 && (b & 0xc0) === 0x80)
    const [a] = splitAt(full, mid)
    const shared = new StringDecoder("utf8")
    shared.write(a) // stdout leaves a partial character pending...
    const fromStderr = shared.write(Buffer.from("plain\n", "utf8"))
    expect(fromStderr).not.toBe("plain\n") // ...and it contaminates the other stream
  })
})
