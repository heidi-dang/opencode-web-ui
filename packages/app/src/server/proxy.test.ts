import { describe, expect, mock, test } from "bun:test"
import { handleOpenCodeProxy } from "./proxy"
import { resetRegistryForTests } from "./server-registry"

function response() {
  return {
    headersSent: false,
    statusCode: 0,
    setHeader: mock(() => undefined),
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
  process.env.OPENCODE_SERVERS_STORE = "/tmp/opencode-proxy-test-registry.json"
  process.env.OPENCODE_SERVERS_CONFIG = JSON.stringify([
    { id: "srv-api", baseUrl: "https://api.example.test" },
    { id: "srv-base", baseUrl: "https://api.example.test/opencode" },
  ])
  resetRegistryForTests()

  test("rejects requests missing the target query parameter", async () => {
    const res = response()
    await handleOpenCodeProxy(request("/api/opencode/health") as any, res as any)
    expect(res.statusCode).toBe(404)
    expect(res.setHeader).toHaveBeenCalledWith("content-type", "application/json; charset=utf-8")
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining("SERVER_NOT_FOUND"))
  })

  test("rejects invalid target protocols", async () => {
    const res = response()
    await handleOpenCodeProxy(request("/api/opencode/health?serverId=file:///etc/passwd") as any, res as any)
    expect(res.statusCode).toBe(404)
    expect(res.setHeader).toHaveBeenCalledWith("content-type", "application/json; charset=utf-8")
    expect(res.end).toHaveBeenCalledWith(expect.stringContaining("SERVER_NOT_FOUND"))
  })

  test("does not forward browser authorization headers to the backend", async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = mock(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.example.test/global/health?directory=%2Frepo&project=one")
      expect(init?.headers).toBeInstanceOf(Headers)
      expect((init?.headers as Headers).get("authorization")).toBeNull()
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
        request("/api/opencode/global/health?serverId=srv-api&directory=%2Frepo&project=one", {
          headers: { host: "localhost:3000", authorization: "Bearer secret", connection: "keep-alive" },
        }) as any,
        res as any,
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(res.statusCode).toBe(200)
    expect(res.setHeader).toHaveBeenCalledWith("content-type", "text/event-stream")
      expect(res.write).toHaveBeenCalledTimes(1)
      expect(res.end).toHaveBeenCalled()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("preserves OpenCode path query parameters after the Vercel rewrite", async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = mock(async (url: URL | RequestInfo) => {
      expect(String(url)).toBe("https://api.example.test/file?path=.&directory=%2Fhome%2Fheidi")
      return Response.json([{ name: "project", type: "directory" }])
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const res = response()
      await handleOpenCodeProxy(
        request("/api?__proxy_route=%2Ffile&serverId=srv-api&path=.&directory=%2Fhome%2Fheidi") as any,
        res as any,
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(res.statusCode).toBe(200)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("preserves a reverse-proxy base path on the upstream target", async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = mock(async (url: URL | RequestInfo) => {
      expect(String(url)).toBe("https://api.example.test/opencode/global/health")
      return Response.json({ healthy: true })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const res = response()
      await handleOpenCodeProxy(
        request("/api/opencode/global/health?serverId=srv-base") as any,
        res as any,
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(res.statusCode).toBe(200)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("maps upstream failures to a safe 502 response", async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async () => { throw new Error("secret internal detail") }) as unknown as typeof fetch
    try {
      const res = response()
      await handleOpenCodeProxy(request("/api/opencode/health?serverId=srv-api") as any, res as any)
      expect(res.statusCode).toBe(502)
      expect(res.end).toHaveBeenCalledWith(expect.not.stringContaining("secret internal detail"))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("aborts the upstream SSE request when the browser response closes", async () => {
    const originalFetch = globalThis.fetch
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    let upstreamSignal: AbortSignal | null | undefined
    globalThis.fetch = mock(async (_url: URL | RequestInfo, init?: RequestInit) => {
      upstreamSignal = init?.signal
      return new Response(
        new ReadableStream({
          start(next) {
            controller = next
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )
    }) as unknown as typeof fetch
    const listeners = new Map<string, () => void>()
    const res = {
      ...response(),
      once(name: string, listener: () => void) {
        listeners.set(name, listener)
      },
      removeListener(name: string) {
        listeners.delete(name)
      },
    }
    try {
      const pending = handleOpenCodeProxy(request("/api/opencode/global/event?serverId=srv-api") as any, res as any)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(upstreamSignal?.aborted).toBe(false)
      listeners.get("close")?.()
      expect(upstreamSignal?.aborted).toBe(true)
      controller?.close()
      await pending
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
