import type { ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, isAbsolute, join, relative, resolve } from "node:path"
import { PassThrough } from "node:stream"
import { afterEach, describe, expect, test, vi } from "vitest"

type SpawnFunction = typeof import("node:child_process").spawn
const { spawnMock, realSpawn } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  realSpawn: { current: undefined as SpawnFunction | undefined },
}))

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process")
  realSpawn.current = actual.spawn
  spawnMock.mockImplementation(actual.spawn)
  return { ...actual, spawn: spawnMock }
})

import { Supervisor, type ServiceDef } from "./supervisor"

const LOG_MAX_BYTES = 5 * 1024 * 1024
const tempRoots: string[] = []
const originalDataDir = process.env.NIGHTJAR_DATA_DIR
const originalVitest = process.env.VITEST
const originalNodeEnv = process.env.NODE_ENV

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "june-nj85-"))
  tempRoots.push(root)
  return root
}

function assertOwnedTempRoot(root: string): void {
  const temp = resolve(tmpdir())
  const candidate = resolve(root)
  const rel = relative(temp, candidate)
  expect(isAbsolute(rel)).toBe(false)
  expect(rel).not.toBe("")
  expect(rel).not.toBe("..")
  expect(rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)).toBe(false)
  expect(basename(candidate).startsWith("june-nj85-")).toBe(true)
}

afterEach(() => {
  spawnMock.mockReset()
  spawnMock.mockImplementation(realSpawn.current!)
  restoreEnv("NIGHTJAR_DATA_DIR", originalDataDir)
  restoreEnv("VITEST", originalVitest)
  restoreEnv("NODE_ENV", originalNodeEnv)
  while (tempRoots.length) {
    const root = tempRoots.pop()!
    assertOwnedTempRoot(root)
    rmSync(root, { recursive: true, force: true })
  }
})

type DiskRecord = Record<string, unknown> & { event: string }

function readRecords(path: string): DiskRecord[] {
  if (!existsSync(path)) return []
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DiskRecord)
}

async function waitForRecord(path: string, event: string): Promise<DiskRecord[]> {
  return waitForRecords(path, (records) => records.some((record) => record.event === event), event)
}

async function waitForRecords(
  path: string,
  predicate: (records: DiskRecord[]) => boolean,
  description: string,
): Promise<DiskRecord[]> {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const records = readRecords(path)
    if (predicate(records)) return records
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
  }
  throw new Error(`timed out waiting for ${description} metadata`)
}

function lfCount(value: string): number {
  return Buffer.from(value, "utf8").reduce((count, byte) => count + (byte === 0x0a ? 1 : 0), 0)
}

function assertStrictSchema(records: DiskRecord[], service = "privacy-service"): void {
  const base = ["at", "event", "restarts", "service", "stderrBytes", "stderrLines", "stdoutBytes", "stdoutLines", "v"]
  const states = new Set(["pending", "starting", "healthy", "unhealthy", "restarting", "stopped", "failed", "adopted"])
  const events = new Set(["state", "spawn", "exit", "spawn_error"])
  const errorCodes = new Set(["E2BIG", "EACCES", "EAGAIN", "EINVAL", "EMFILE", "ENFILE", "ENOENT", "ENOEXEC", "ENOMEM", "ENOTDIR", "EPERM", "UNKNOWN"])
  for (const record of records) {
    const allowed = new Set(base)
    if (record.event === "state") allowed.add("state")
    if (record.event === "spawn_error") allowed.add("errorCode")
    if (["state", "spawn", "exit", "spawn_error"].includes(record.event)) allowed.add("pid")
    if (record.event === "exit") {
      allowed.add("exitCode")
      allowed.add("signal")
    }
    expect(Object.keys(record).every((key) => allowed.has(key))).toBe(true)
    expect(record.v).toBe(1)
    expect(record.service).toBe(service)
    expect(events.has(record.event)).toBe(true)
    expect(Number.isNaN(Date.parse(String(record.at)))).toBe(false)
    for (const key of ["restarts", "stdoutBytes", "stdoutLines", "stderrBytes", "stderrLines"]) {
      expect(Number.isSafeInteger(record[key])).toBe(true)
      expect(record[key] as number).toBeGreaterThanOrEqual(0)
    }
    if (record.event === "state") expect(states.has(String(record.state))).toBe(true)
    if (record.event === "spawn_error") expect(errorCodes.has(String(record.errorCode))).toBe(true)
    if (record.pid !== undefined) {
      expect(Number.isSafeInteger(record.pid)).toBe(true)
      expect(record.pid as number).toBeGreaterThan(0)
    }
    if (record.exitCode !== undefined) expect(record.exitCode as number).toBeGreaterThanOrEqual(0)
    if (record.signal !== undefined) expect(record.signal).toMatch(/^SIG[A-Z0-9]+$/)
  }
}

function shortLivedService(name: string, stdout: string, stderr: string): ServiceDef {
  const source = `process.stdout.write(${JSON.stringify(stdout)}); process.stderr.write(${JSON.stringify(stderr)})`
  return {
    name,
    command: process.execPath,
    args: ["-e", source],
    ready: async () => false,
    readyTimeoutMs: 5000,
    autoRestart: false,
  }
}

async function writeStoppedState(logDir: string, name = "rotation-service"): Promise<void> {
  const service: ServiceDef = {
    name,
    command: "unused",
    args: [],
    ready: async () => false,
    enabled: () => false,
  }
  await new Supervisor([service], undefined, { serviceLogDir: logDir }).start()
}

describe("Supervisor persistent service metadata (NJ-85)", () => {
  test("persists strict metadata while raw conversation, secrets, paths, and URLs stay memory-only", async () => {
    const root = makeTempRoot()
    const logDir = join(root, "logs")
    const logFile = join(logDir, "privacy-service.log")
    const secrets = [
      "TRANSCRIPT-canary-user-speech",
      "ASSISTANT-canary-reply",
      "PROMPT-canary-private-request",
      "Bearer canary-access-token",
      "sk-canary-secret-key",
      "C:\\Users\\private\\conversation.txt",
      "https://example.invalid/private?token=canary",
      "SESSION-canary-identifier",
    ]
    const stdout = [
      `${secrets[0]}\r\n`,
      `${secrets[1]}\n${secrets[2]}\n`,
      `${secrets[3]}\n${secrets[5]}\n${secrets[6]}\n`,
      `\u001b[31m{\"event\":\"forged\",\"value\":\"${secrets[7]}\"}\u001b[0m\n`,
      "UTF-8 punctuation: I\u2019m ready \u2014 42.\nunterminated-tail",
    ].join("")
    const stderr = `${secrets[4]}\nerror-detail-must-not-persist\n`
    const supervisor = new Supervisor([shortLivedService("privacy-service", stdout, stderr)], undefined, { serviceLogDir: logDir })

    await supervisor.start()
    const records = await waitForRecord(logFile, "exit")
    const disk = readdirSync(logDir).map((name) => readFileSync(join(logDir, name), "utf8")).join("\n")
    const memory = supervisor.logs("privacy-service").join("")

    for (const secret of secrets) {
      expect(memory).toContain(secret)
      expect(disk).not.toContain(secret)
    }
    expect(disk).not.toContain("error-detail-must-not-persist")
    expect(disk).not.toContain("forged")
    assertStrictSchema(records)
    expect(records).toContainEqual(expect.objectContaining({ event: "spawn", pid: expect.any(Number) }))

    const exit = records.find((record) => record.event === "exit")!
    expect(exit.stdoutBytes).toBe(Buffer.byteLength(stdout, "utf8"))
    expect(exit.stdoutLines).toBe(lfCount(stdout))
    expect(exit.stderrBytes).toBe(Buffer.byteLength(stderr, "utf8"))
    expect(exit.stderrLines).toBe(lfCount(stderr))
    expect(exit.pid).toBeGreaterThan(0)
    expect(exit.exitCode).toBe(0)
  }, 15000)

  test("stores only an allow-listed spawn error code, never the command or error text", async () => {
    const root = makeTempRoot()
    const logDir = join(root, "logs")
    const commandCanary = "missing-command-with-private-canary-xyz"
    const service: ServiceDef = {
      name: "privacy-service",
      command: commandCanary,
      args: [],
      ready: async () => false,
      autoRestart: false,
    }
    const supervisor = new Supervisor([service], undefined, { serviceLogDir: logDir })

    await supervisor.start()
    const records = await waitForRecord(join(logDir, "privacy-service.log"), "spawn_error")
    const disk = readFileSync(join(logDir, "privacy-service.log"), "utf8")
    expect(records.find((record) => record.event === "spawn_error")?.errorCode).toBe("ENOENT")
    expect(records.some((record) => record.event === "spawn")).toBe(false)
    expect(supervisor.logs("privacy-service").join("")).toContain(commandCanary)
    expect(disk).not.toContain(commandCanary)
    expect(disk).not.toContain("spawn error:")
    assertStrictSchema(records)
  }, 10000)

  test("normalizes an unknown secret-bearing spawn code to UNKNOWN", async () => {
    const root = makeTempRoot()
    const logDir = join(root, "logs")
    const logFile = join(logDir, "privacy-service.log")
    const errorMessage = "private provider path C:\\Users\\private\\secret-model.bin"
    const hostileCode = "ESECRET_CANARY"
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: undefined,
    }) as unknown as ChildProcess
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => {
        const error = Object.assign(new Error(errorMessage), { code: hostileCode })
        child.emit("error", error)
        child.emit("close", null, null)
      })
      return child
    })
    const service: ServiceDef = {
      name: "privacy-service",
      command: "unused-private-command",
      args: [],
      ready: async () => false,
      autoRestart: false,
    }
    const supervisor = new Supervisor([service], undefined, { serviceLogDir: logDir })

    await supervisor.start()
    const records = await waitForRecord(logFile, "spawn_error")
    const disk = readFileSync(logFile, "utf8")
    expect(records.find((record) => record.event === "spawn_error")?.errorCode).toBe("UNKNOWN")
    expect(records.some((record) => record.event === "spawn")).toBe(false)
    expect(supervisor.logs("privacy-service").join("")).toContain(errorMessage)
    expect(disk).not.toContain(errorMessage)
    expect(disk).not.toContain(hostileCode)
    assertStrictSchema(records)
  }, 10000)

  test("records restart attempts and keeps each process generation's exit metadata separate", async () => {
    const root = makeTempRoot()
    const logDir = join(root, "logs")
    const logFile = join(logDir, "privacy-service.log")
    const service = shortLivedService("privacy-service", "generation-output\n", "")
    service.args = ["-e", "process.stdout.write('generation-output\\n'); process.exitCode = 3"]
    service.autoRestart = true
    service.maxRestarts = 1
    const supervisor = new Supervisor([service], undefined, { serviceLogDir: logDir })

    await supervisor.start()
    const records = await waitForRecords(
      logFile,
      (rows) =>
        rows.filter((record) => record.event === "exit").length === 2 &&
        rows.some((record) => record.event === "state" && record.state === "failed" && record.restarts === 1),
      "two process generations",
    )

    const exits = records.filter((record) => record.event === "exit")
    expect(exits.map((record) => record.restarts)).toEqual([0, 1])
    expect(exits.map((record) => record.exitCode)).toEqual([3, 3])
    expect(exits.every((record) => record.stdoutBytes === Buffer.byteLength("generation-output\n"))).toBe(true)
    expect(records).toContainEqual(expect.objectContaining({ event: "state", state: "restarting", restarts: 1 }))
    assertStrictSchema(records)
  }, 15000)

  test("removes unsafe or oversized legacy raw logs before writing structured metadata", async () => {
    const root = makeTempRoot()
    const logDir = join(root, "logs")
    const active = join(logDir, "rotation-service.log")
    const rotated = `${active}.1`
    const transcript = "LEGACY-TRANSCRIPT-private-speech"
    const token = "LEGACY-Bearer-private-token"
    mkdirSync(logDir, { recursive: true })
    const prefix = Buffer.from(`${transcript}\n`, "utf8")
    writeFileSync(active, Buffer.concat([prefix, Buffer.alloc(LOG_MAX_BYTES + 1 - prefix.length, 0x58)]))
    writeFileSync(rotated, `${token}\nC:\\Users\\private\\voice-session.txt\n`)

    await writeStoppedState(logDir)
    const files = readdirSync(logDir).sort()
    const disk = files.map((name) => readFileSync(join(logDir, name), "utf8")).join("\n")
    expect(files).toEqual(["rotation-service.log"])
    expect(statSync(active).size).toBeLessThan(LOG_MAX_BYTES)
    expect(disk).not.toContain(transcript)
    expect(disk).not.toContain(token)
    expect(disk).not.toContain("C:\\Users\\private")
    assertStrictSchema(readRecords(active), "rotation-service")
  }, 10000)

  test("cleans a conditional service's legacy raw logs without touching unrelated logs", async () => {
    const root = makeTempRoot()
    const logDir = join(root, "logs")
    const ollama = join(logDir, "ollama.log")
    const unrelated = join(logDir, "unrelated.log")
    mkdirSync(logDir, { recursive: true })
    writeFileSync(ollama, "legacy prompt and token\n")
    writeFileSync(`${ollama}.1`, "legacy assistant reply\n")
    writeFileSync(unrelated, "owned by another logger\n")
    const service: ServiceDef = {
      name: "privacy-service",
      command: "unused",
      args: [],
      ready: async () => false,
      enabled: () => false,
    }

    const supervisor = new Supervisor([service], undefined, { serviceLogDir: logDir })
    expect(existsSync(ollama)).toBe(false)
    expect(existsSync(`${ollama}.1`)).toBe(false)
    expect(readFileSync(unrelated, "utf8")).toBe("owned by another logger\n")
    await supervisor.start()
  })

  test("rotates at the 5 MiB byte boundary and retains only active plus one .log.1", async () => {
    const root = makeTempRoot()
    const logDir = join(root, "logs")
    const active = join(logDir, "rotation-service.log")
    const rotated = `${active}.1`
    await writeStoppedState(logDir)
    const safeLine = readFileSync(active, "utf8")
    const recordBytes = Buffer.byteLength(safeLine, "utf8")
    const recordsPerGeneration = Math.floor(LOG_MAX_BYTES / recordBytes)
    expect(recordsPerGeneration).toBeGreaterThan(1)

    writeFileSync(active, safeLine.repeat(recordsPerGeneration - 1))
    await writeStoppedState(logDir)
    expect(statSync(active).size).toBe(recordsPerGeneration * recordBytes)
    expect(existsSync(rotated)).toBe(false)

    await writeStoppedState(logDir)
    expect(statSync(rotated).size).toBe(recordsPerGeneration * recordBytes)
    expect(statSync(active).size).toBe(recordBytes)

    const secondGeneration = JSON.parse(safeLine) as Record<string, unknown>
    secondGeneration.state = "healthy"
    const secondLine = `${JSON.stringify(secondGeneration)}\n`
    expect(Buffer.byteLength(secondLine, "utf8")).toBe(recordBytes)
    writeFileSync(active, secondLine.repeat(recordsPerGeneration))
    await writeStoppedState(logDir)
    expect(statSync(rotated).size).toBe(recordsPerGeneration * recordBytes)
    expect(readFileSync(rotated, "utf8").startsWith(secondLine)).toBe(true)
    expect(statSync(active).size).toBe(recordBytes)
    expect(readdirSync(logDir).sort()).toEqual(["rotation-service.log", "rotation-service.log.1"])
    expect(statSync(active).size).toBeLessThanOrEqual(LOG_MAX_BYTES)
    expect(statSync(rotated).size).toBeLessThanOrEqual(LOG_MAX_BYTES)
  }, 20000)

  test("drops metadata instead of growing a full log when rotation fails", async () => {
    const root = makeTempRoot()
    const logDir = join(root, "logs")
    const active = join(logDir, "rotation-service.log")
    const rotated = `${active}.1`
    const service: ServiceDef = {
      name: "rotation-service",
      command: "unused",
      args: [],
      ready: async () => false,
      enabled: () => false,
    }
    const supervisor = new Supervisor([service], undefined, { serviceLogDir: logDir })
    await supervisor.start() // prepares this service's files once
    const safeLine = readFileSync(active, "utf8")
    const recordBytes = Buffer.byteLength(safeLine, "utf8")
    writeFileSync(active, safeLine.repeat(Math.floor(LOG_MAX_BYTES / recordBytes)))
    const activeBytes = statSync(active).size
    expect(activeBytes + recordBytes).toBeGreaterThan(LOG_MAX_BYTES)
    mkdirSync(rotated, { recursive: true })
    writeFileSync(join(rotated, "rotation-blocker"), "keep")

    await expect(supervisor.start()).resolves.toBeUndefined() // reaches rotation; .1 cannot be removed
    expect(statSync(active).size).toBe(activeBytes)
    expect(statSync(rotated).isDirectory()).toBe(true)
    expect(readFileSync(join(rotated, "rotation-blocker"), "utf8")).toBe("keep")
  }, 10000)

  test.each(["../escape", "..\\escape", "CON", "LPT1"])("rejects unsafe service filename %s without breaking supervision", async (name) => {
    const root = makeTempRoot()
    const logDir = join(root, "logs")
    await expect(writeStoppedState(logDir, name)).resolves.toBeUndefined()
    expect(existsSync(logDir)).toBe(true)
    expect(readdirSync(logDir)).toEqual([])
    expect(existsSync(join(root, "escape.log"))).toBe(false)
  })

  test("a filesystem failure is non-fatal and leaves raw output available only in memory", async () => {
    const root = makeTempRoot()
    const blocker = join(root, "not-a-directory")
    writeFileSync(blocker, "block")
    const output = "memory-only-after-log-write-failure\n"
    const supervisor = new Supervisor([shortLivedService("privacy-service", output, "")], undefined, {
      serviceLogDir: join(blocker, "logs"),
    })

    await expect(supervisor.start()).resolves.toBeUndefined()
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !supervisor.logs("privacy-service").join("").includes(output.trim())) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 25))
    }
    expect(supervisor.logs("privacy-service").join("")).toContain(output.trim())
    expect(readFileSync(blocker, "utf8")).toBe("block")
  }, 10000)

  test("Vitest requires an explicit temporary log directory", async () => {
    const root = makeTempRoot()
    process.env.NIGHTJAR_DATA_DIR = root
    const service: ServiceDef = {
      name: "privacy-service",
      command: "unused",
      args: [],
      ready: async () => false,
      enabled: () => false,
    }

    await new Supervisor([service]).start()
    expect(process.env.VITEST).toBeTruthy()
    expect(existsSync(join(root, "logs"))).toBe(false)
  })

  test("production defaults to the configured JUNE data directory", async () => {
    const root = makeTempRoot()
    process.env.NIGHTJAR_DATA_DIR = root
    delete process.env.VITEST
    process.env.NODE_ENV = "production"
    const service: ServiceDef = {
      name: "privacy-service",
      command: "unused",
      args: [],
      ready: async () => false,
      enabled: () => false,
    }

    await new Supervisor([service]).start()
    const file = join(root, "logs", "privacy-service.log")
    expect(existsSync(file)).toBe(true)
    assertStrictSchema(readRecords(file))
  })
})
