import { describe, expect, test } from "bun:test"
import { clientIdentityKey, createClientDiagnosticLimiter, sanitizeClientDiagnostic } from "./client-diagnostics"

describe("client diagnostic ingestion", () => {
  test("keeps only safe bounded fields and redacts prompt-like messages", () => {
    const result = sanitizeClientDiagnostic({
      level: "error",
      event: "prompt.error",
      message: "prompt text: do not collect this private content",
      stack: "Error: prompt text: do not collect this private content\n at app.ts:1:1",
      route: "/session/ses_1",
      backendId: "srv_1",
      prompt: "private prompt",
      token: "private token",
      extra: { password: "private password" },
    })

    expect(result).toMatchObject({ level: "error", event: "prompt.error", route: "/session/ses_1", backendId: "srv_1" })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("private content")
    expect(serialized).not.toContain("private prompt")
    expect(serialized).not.toContain("private token")
    expect(serialized).not.toContain("private password")
    expect(serialized).not.toContain("extra")
  })

  test("rejects malformed or oversized diagnostic payloads", () => {
    expect(sanitizeClientDiagnostic(null)).toBeUndefined()
    expect(sanitizeClientDiagnostic({ event: "invalid event!" })).toBeUndefined()
    expect(sanitizeClientDiagnostic({ event: "safe", message: "x".repeat(5000) })).toBeUndefined()
  })

  test("allows a bounded number of events per client window", () => {
    const limiter = createClientDiagnosticLimiter({ maxEvents: 2, windowMs: 10_000, now: () => 100 })
    expect(limiter.allow("client-a")).toBe(true)
    expect(limiter.allow("client-a")).toBe(true)
    expect(limiter.allow("client-a")).toBe(false)
    expect(limiter.allow("client-b")).toBe(true)
  })

  test("isolates trusted forwarded clients and ignores spoofed forwarding headers", () => {
    const trustedA = clientIdentityKey({ socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": "203.0.113.10" } } as any)
    const trustedB = clientIdentityKey({ socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": "203.0.113.11" } } as any)
    const spoofed = clientIdentityKey({ socket: { remoteAddress: "203.0.113.20" }, headers: { "x-forwarded-for": "203.0.113.10" } } as any)
    const direct = clientIdentityKey({ socket: { remoteAddress: "203.0.113.20" }, headers: {} } as any)
    expect(trustedA).not.toBe(trustedB)
    expect(spoofed).toBe(direct)
  })
})
