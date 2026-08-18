import { describe, expect, test } from "bun:test"
import { createLogger, normalizeRequestId, type LogRecord } from "./logger"

describe("structured runtime logger", () => {
  test("filters below the configured level and emits JSON records", () => {
    const records: LogRecord[] = []
    const logger = createLogger({ level: "info", sink: (record) => records.push(record) })

    logger.debug("debug.hidden", { backendId: "srv_debug" })
    logger.info("backend.ready", { backendId: "srv_1", protocol: "v2" })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ level: "info", event: "backend.ready", backendId: "srv_1", protocol: "v2" })
    expect(JSON.parse(logger.serialize(records[0]))).toMatchObject({ event: "backend.ready" })
  })

  test("redacts credentials, secrets, bodies, and sensitive URL query values", () => {
    const records: LogRecord[] = []
    const logger = createLogger({ level: "trace", sink: (record) => records.push(record) })

    logger.error("request.error", {
      url: "https://example.test/api?token=secret-token&safe=1",
      authorization: "Bearer secret-auth",
      password: "secret-password",
      nested: { cookie: "session-cookie", apiKey: "secret-key", body: "prompt text" },
      errorMessage: "upstream failed",
    })

    const serialized = logger.serialize(records[0])
    expect(serialized).not.toContain("secret-token")
    expect(serialized).not.toContain("secret-auth")
    expect(serialized).not.toContain("secret-password")
    expect(serialized).not.toContain("session-cookie")
    expect(serialized).not.toContain("secret-key")
    expect(serialized).not.toContain("prompt text")
    expect(serialized).toContain("safe=1")
    expect(serialized).toContain("upstream failed")
  })

  test("serializes errors and circular values without throwing", () => {
    const records: LogRecord[] = []
    const logger = createLogger({ level: "debug", sink: (record) => records.push(record) })
    const circular: Record<string, unknown> = { operation: "health" }
    circular.self = circular

    logger.warn("health.error", { error: new Error("safe failure"), circular })

    expect(() => logger.serialize(records[0])).not.toThrow()
    expect(logger.serialize(records[0])).toContain("safe failure")
    expect(logger.serialize(records[0])).toContain("[Circular]")
  })

  test("accepts only bounded safe request IDs", () => {
    expect(normalizeRequestId("req_manual-123")).toBe("req_manual-123")
    expect(normalizeRequestId("a".repeat(200))).toBeUndefined()
    expect(normalizeRequestId("Bearer secret")).toBeUndefined()
    expect(normalizeRequestId(undefined)).toBeUndefined()
  })
})
