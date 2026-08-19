import { describe, expect, mock, test } from "bun:test"
import { createClientDiagnostics } from "./client-diagnostics"

describe("browser client diagnostics", () => {
  test("sends bounded safe API failures without prompt or credential fields", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const diagnostics = createClientDiagnostics({
      enabled: true,
      fetcher: mock(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init })
        return new Response(null, { status: 204 })
      }) as unknown as typeof fetch,
    })

    await diagnostics.report("prompt.error", { message: "prompt text: private content", backendId: "srv_1", token: "secret" })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe("/api/debug/client-events")
    const body = String(calls[0].init?.body)
    expect(body).not.toContain("private content")
    expect(body).not.toContain("secret")
    expect(body).toContain("srv_1")
  })

  test("does not recursively report telemetry endpoint failures", async () => {
    const calls: Array<string> = []
    const diagnostics = createClientDiagnostics({
      enabled: true,
      fetcher: mock(async (url: RequestInfo | URL) => {
        calls.push(String(url))
        throw new Error("telemetry unavailable")
      }) as unknown as typeof fetch,
    })

    await diagnostics.report("client.error", { message: "first error" })
    await diagnostics.report("client.error", { message: "second error" })

    expect(calls).toEqual(["/api/debug/client-events", "/api/debug/client-events"])
  })
})
