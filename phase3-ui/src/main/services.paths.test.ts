import { describe, test, expect } from "vitest"
import { nightjarServices } from "./services"

// audit1.md P1-4: the default local llama-server path must be OS-shaped — a Windows CUDA build
// emits `llama-server.exe`, the Linux build has no `.exe`. A wrong-OS default ENOENTs and local
// (offline, default) chat can't start. Overridable via NIGHTJAR_LLAMA_BIN.
describe("llama-server default path is OS-correct (P1-4)", () => {
  const llama = nightjarServices().find((s) => s.name === "llama-server")

  test("llama-server service is defined", () => {
    expect(llama).toBeTruthy()
  })

  test("default command ends with .exe on Windows, not on POSIX", () => {
    if (process.env.NIGHTJAR_LLAMA_BIN) return // an explicit override is the user's own shape
    if (process.platform === "win32") {
      expect(llama!.command.toLowerCase().endsWith(".exe")).toBe(true)
    } else {
      expect(llama!.command.endsWith(".exe")).toBe(false)
    }
  })
})
