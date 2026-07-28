import { describe, expect, test } from "bun:test"
import { normalizeConnectionType } from "./fleet-types"
import type { ServerConnection } from "@/context/server"

describe("normalizeConnectionType", () => {
  const makeHttp = (): ServerConnection.Any => ({
    type: "http",
    http: { url: "http://localhost:4096" },
  })

  const makeSidecar = (variant?: string): ServerConnection.Any => ({
    type: "sidecar",
    http: { url: "http://localhost:4096" },
    ...(variant ? { variant } : {}),
  } as ServerConnection.Any)

  const makeSsh = (): ServerConnection.Any => ({
    type: "ssh",
    host: "remote",
    http: { url: "http://remote:4096" },
  })

  test("returns http for http connections", () => {
    expect(normalizeConnectionType(makeHttp())).toBe("http")
  })

  test("returns sidecar for base sidecar", () => {
    const conn = makeSidecar("base")
    expect(normalizeConnectionType(conn)).toBe("sidecar")
  })

  test("returns wsl for sidecar with wsl variant", () => {
    const conn = makeSidecar("wsl")
    expect(normalizeConnectionType(conn)).toBe("wsl")
  })

  test("returns sidecar for unknown sidecar variant", () => {
    const conn = makeSidecar("docker")
    expect(normalizeConnectionType(conn)).toBe("sidecar")
  })

  test("returns ssh for ssh connections", () => {
    expect(normalizeConnectionType(makeSsh())).toBe("ssh")
  })
})

describe("fleet-types constants", () => {
  test("HEALTH_CONCURRENCY is 4", () => {
    const { HEALTH_CONCURRENCY } = require("./fleet-types")
    expect(HEALTH_CONCURRENCY).toBe(4)
  })

  test("POLL_INTERVAL_MS is 30000", () => {
    const { POLL_INTERVAL_MS } = require("./fleet-types")
    expect(POLL_INTERVAL_MS).toBe(30000)
  })

  test("HEALTH_PROBE_TIMEOUT_MS is 5000", () => {
    const { HEALTH_PROBE_TIMEOUT_MS } = require("./fleet-types")
    expect(HEALTH_PROBE_TIMEOUT_MS).toBe(5000)
  })
})

describe("fleet-format", () => {
  test("formatRelativeTime returns just now for recent timestamps", async () => {
    const { formatRelativeTime } = await import("./fleet-format")
    expect(formatRelativeTime(Date.now())).toBe("just now")
    expect(formatRelativeTime(Date.now() - 3000)).toBe("just now")
  })

  test("formatRelativeTime returns seconds for < 60s", async () => {
    const { formatRelativeTime } = await import("./fleet-format")
    expect(formatRelativeTime(Date.now() - 15000)).toBe("15s ago")
  })

  test("formatRelativeTime returns minutes for < 60m", async () => {
    const { formatRelativeTime } = await import("./fleet-format")
    expect(formatRelativeTime(Date.now() - 120000)).toBe("2m ago")
  })

  test("formatRelativeTime returns hours for < 24h", async () => {
    const { formatRelativeTime } = await import("./fleet-format")
    expect(formatRelativeTime(Date.now() - 7200000)).toBe("2h ago")
  })

  test("formatRelativeTime returns days for >= 24h", async () => {
    const { formatRelativeTime } = await import("./fleet-format")
    expect(formatRelativeTime(Date.now() - 172800000)).toBe("2d ago")
  })

  test("formatRelativeTime returns em-dash for undefined", async () => {
    const { formatRelativeTime } = await import("./fleet-format")
    expect(formatRelativeTime(undefined)).toBe("\u2014")
  })

  test("formatVersion strips leading v", async () => {
    const { formatVersion } = await import("./fleet-format")
    expect(formatVersion("v1.2.3")).toBe("1.2.3")
    expect(formatVersion("1.2.3")).toBe("1.2.3")
  })

  test("formatVersion returns em-dash for undefined", async () => {
    const { formatVersion } = await import("./fleet-format")
    expect(formatVersion(undefined)).toBe("\u2014")
  })

  test("formatLatency returns ms for < 1000ms", async () => {
    const { formatLatency } = await import("./fleet-format")
    expect(formatLatency(42)).toBe("~42ms")
    expect(formatLatency(999)).toBe("~999ms")
  })

  test("formatLatency returns seconds for >= 1000ms", async () => {
    const { formatLatency } = await import("./fleet-format")
    expect(formatLatency(1500)).toBe("~1.5s")
  })

  test("formatLatency returns em-dash for undefined", async () => {
    const { formatLatency } = await import("./fleet-format")
    expect(formatLatency(undefined)).toBe("\u2014")
  })
})
