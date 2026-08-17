import { describe, expect, test } from "bun:test"
import { ConnectionManager } from "./connection-manager"

describe("ConnectionManager", () => {
  test("deduplicates probes and reaches ready after stream startup", async () => {
    let probes = 0
    const manager = new ConnectionManager(async () => {
      probes++
      return "v2"
    })

    expect(await Promise.all([manager.connect(), manager.connect()])).toEqual(["v2", "v2"])
    manager.markStreamReady()
    expect(probes).toBe(1)
    expect(manager.snapshot.state).toBe("READY")
  })

  test("invalidates protocol after stream failure so the next retry re-detects", async () => {
    let probes = 0
    const manager = new ConnectionManager(async () => {
      probes++
      return probes === 1 ? "v1" : "v2"
    }, { baseDelayMs: 10, random: () => 0.5 })

    expect(await manager.connect()).toBe("v1")
    manager.markStreamFailure(new Error("closed"))
    expect(await manager.connect()).toBe("v2")
    expect(manager.snapshot.failures).toBe(0)
  })

  test("opens and half-opens the circuit after the cooldown", async () => {
    let probes = 0
    const manager = new ConnectionManager(async () => {
      probes++
      if (probes === 1) throw new Error("offline")
      return "v2"
    }, { maxFailures: 1, cooldownMs: 1, random: () => 0.5 })

    await expect(manager.connect()).rejects.toThrow("offline")
    expect(manager.circuitState()).toBe("OPEN")
    await new Promise((resolve) => setTimeout(resolve, 2))
    expect(await manager.connect()).toBe("v2")
    expect(manager.circuitState()).toBe("CLOSED")
  })

  test("uses bounded jittered exponential retry delays", () => {
    const manager = new ConnectionManager(async () => "v2", { baseDelayMs: 100, maxDelayMs: 250, random: () => 0.5 })
    expect(manager.retryDelay()).toBe(100)
    manager.markStreamFailure(new Error("closed"))
    expect(manager.retryDelay()).toBe(100)
    manager.markStreamFailure(new Error("closed"))
    expect(manager.retryDelay()).toBe(200)
    manager.markStreamFailure(new Error("closed"))
    expect(manager.retryDelay()).toBe(250)
  })
})
