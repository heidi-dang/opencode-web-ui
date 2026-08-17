import { describe, expect, test } from "bun:test"
import { createServerTransport } from "./server-transport"

describe("server transport", () => {
  test("tracks successful and failed requests independently", async () => {
    const transport = createServerTransport({
      fetch: (async (_input, init) => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        if (init?.headers && new Headers(init.headers).get("x-fail")) return new Response("failed", { status: 503 })
        return Response.json({ ok: true })
      }) as typeof globalThis.fetch,
    })

    await transport.request("https://example.test/ok")
    await transport.request("https://example.test/fail", { headers: { "x-fail": "1" } })
    expect(transport.metrics()).toMatchObject({ requests: 2, failures: 1, inFlight: 0 })
    expect(transport.metrics().lastLatencyMs).toBeGreaterThanOrEqual(1)
  })
})
