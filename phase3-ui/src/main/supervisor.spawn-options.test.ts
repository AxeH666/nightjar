import type { SpawnOptions } from "node:child_process"
import { afterEach, describe, expect, test, vi } from "vitest"

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process")
  return { ...actual, spawn: spawnMock }
})

import { Supervisor, type ServiceDef } from "./supervisor"

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!

afterEach(() => {
  Object.defineProperty(process, "platform", originalPlatform)
  spawnMock.mockReset()
})

async function capturedSpawnOptions(platform: NodeJS.Platform): Promise<SpawnOptions> {
  Object.defineProperty(process, "platform", {
    configurable: true,
    enumerable: originalPlatform.enumerable,
    value: platform,
  })

  const stop = new Error("spawn captured")
  spawnMock.mockImplementationOnce(() => {
    throw stop
  })

  const service: ServiceDef = {
    name: "nj90-test-service",
    command: "unused",
    args: [],
    ready: async () => false,
  }
  await expect(new Supervisor([service]).start()).rejects.toBe(stop)

  expect(spawnMock).toHaveBeenCalledOnce()
  return spawnMock.mock.calls[0][2] as SpawnOptions
}

describe("Supervisor sidecar spawn options (NJ-90)", () => {
  test.each([
    ["win32", false],
    ["linux", true],
    ["darwin", true],
  ] as const)("%s uses detached=%s", async (platform, detached) => {
    const options = await capturedSpawnOptions(platform)

    expect(options.detached).toBe(detached)
    expect(options.windowsHide).toBe(true)
    expect(options.stdio).toEqual(["ignore", "pipe", "pipe"])
  })
})
