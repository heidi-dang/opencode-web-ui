import { describe, expect, mock, test } from "bun:test"
import { handleOpenCodeProxy } from "./proxy"

function response() {
  return {
    headersSent: false,
    writeHead: mock(() => undefined),
    write: mock(() => true),
    end: mock(() => undefined),
  }
}

function request(url: string, init: Record<string, unknown> = {}) {
  return {
    url,
    method: "GET",
    headers: { host: "localhost:3000" },
    async *[Symbol.asyncIterator]() {},
    ...init,
  }
}

describe("Universal OpenCode Proxy", () => {
  test("rejects requests missing the target query parameter", async () => {
    const res = response()
    await handleOpenCodeProxy(request("/api/opencode/health") as any, res as any)
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining("Missing target server parameter"))
  })

  test("rejects invalid target protocols", async () => {
    const res = response()
    await handleOpenCodeProxy(request("/api/opencode/health?target=file:///etc/passwd") as any, res as any)
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.any(Object))
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining("Invalid target server URL"))
  })

  test("forwards the rewritten URL, auth headers, and streams the response", async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = mock(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.example.test/global/health?directory=%2Frepo&project=one")
      expect(init?.headers).toBeInstanceOf(Headers)
      expect((init?.headers as Headers).get("authorization")).toBe("Bearer secret")
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: ready\n\n"))
          controller.close()
        },
      }), { status: 200, headers: { "content-type": "text/event-stream" } })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const res = response()
      await handleOpenCodeProxy(
        request("/api/opencode/global/health?target=https%3A%2F%2Fapi.example.test&directory=%2Frepo&project=one", {
          headers: { host: "localhost:3000", authorization: "Bearer secret", connection: "keep-alive" },
        }) as any,
        res as any,
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(res.writeHead).toHaveBeenCalledWith(200, { "content-type": "text/event-stream" })
      expect(res.write).toHaveBeenCalledTimes(1)
      expect(res.end).toHaveBeenCalled()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("maps upstream failures to a safe 502 response", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async () => { throw new Error("secret internal detail") }) as unknown as typeof fetch
    try {
      const res = response()
      await handleOpenCodeProxy(request("/api/opencode/health?target=https%3A%2F%2Fapi.example.test") as any, res as any)
      expect(res.writeHead).toHaveBeenCalledWith(502, expect.any(Object))
      expect(res.end).toHaveBeenCalledWith(expect.not.stringContaining("secret internal detail"))
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
