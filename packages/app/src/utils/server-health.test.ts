import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "@/context/server"
import { checkServerHealth } from "./server-health"

const server: ServerConnection.HttpBase = {
  url: "http://localhost:4096",
}

function headerValue(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers
  if (!headers) return undefined
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  if (Array.isArray(headers)) {
    const found = (headers as Array<[string, string]>).find(([key]) => key.toLowerCase() === name.toLowerCase())
    return found?.[1]
  }
  const record = headers as Record<string, string>
  return record[name] ?? record[name.toLowerCase()]
}

function abortFromInput(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.signal) return init.signal
  if (input instanceof Request) return input.signal
  return undefined
}

describe("checkServerHealth", () => {
  test("returns healthy response with version", async () => {
    let request: URL | undefined
    const fetch = (async (input: RequestInfo | URL) => {
      request = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
      return new Response(JSON.stringify({ healthy: true, version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch)

    expect(result).toEqual({ healthy: true, version: "1.2.3" })
    expect(request?.pathname).toBe("/health")
  })

  test("falls back to the V1 health endpoint", async () => {
    const paths: string[] = []
    const fetch = (async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
      paths.push(url.pathname)
      if (url.pathname === "/health") return new Response(undefined, { status: 404 })
      if (url.pathname === "/global/health") return new Response(undefined, { status: 404 })
      return Response.json({ healthy: true, version: "1.18.4" })
    }) as unknown as typeof globalThis.fetch

    expect(await checkServerHealth(server, fetch)).toEqual({ healthy: true, version: "1.18.4" })
    expect(paths).toEqual(["/health", "/global/health", "/api/health"])
  })

  test("falls back when the current health response is malformed", async () => {
    const paths: string[] = []
    const fetch = (async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
      paths.push(url.pathname)
      if (url.pathname === "/health") return new Response("null", { status: 500 })
      if (url.pathname === "/global/health") return new Response("null", { status: 500 })
      return Response.json({ healthy: true, version: "1.18.4" })
    }) as unknown as typeof globalThis.fetch

    expect(await checkServerHealth(server, fetch)).toEqual({ healthy: true, version: "1.18.4" })
    expect(paths).toEqual(["/health", "/global/health", "/api/health"])
  })

  test("allows slow servers thirty seconds by default", async () => {
    const timeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")
    let timeoutMs = 0
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      value: (ms: number) => {
        timeoutMs = ms
        return new AbortController().signal
      },
    })

    const fetch = (async () =>
      new Response(JSON.stringify({ healthy: true, version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof globalThis.fetch

    await checkServerHealth(server, fetch).finally(() => {
      if (timeout) Object.defineProperty(AbortSignal, "timeout", timeout)
      if (!timeout) Reflect.deleteProperty(AbortSignal, "timeout")
    })

    expect(timeoutMs).toBe(30_000)
  })

  test("returns unhealthy when request fails", async () => {
    const fetch = (async () => {
      throw new Error("network")
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch)

    expect(result).toEqual({ healthy: false, requiresAuth: false, authFailed: false })
  })

  test("uses timeout fallback when AbortSignal.timeout is unavailable", async () => {
    const timeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      value: undefined,
    })

    let aborted = false
    const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const signal = abortFromInput(input, init)
      if (signal?.aborted) {
        aborted = true
        return Promise.reject(new DOMException("Aborted", "AbortError"))
      }
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            aborted = true
            reject(new DOMException("Aborted", "AbortError"))
          },
          { once: true },
        )
      })
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, {
      timeoutMs: 10,
    }).finally(() => {
      if (timeout) Object.defineProperty(AbortSignal, "timeout", timeout)
      if (!timeout) Reflect.deleteProperty(AbortSignal, "timeout")
    })

    expect(aborted).toBe(true)
    expect(result).toEqual({ healthy: false })
  })

  test("uses provided abort signal", async () => {
    let signal: AbortSignal | undefined
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      signal = abortFromInput(input, init)
      return new Response(JSON.stringify({ healthy: true, version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const abort = new AbortController()
    await checkServerHealth(server, fetch, {
      signal: abort.signal,
    })

    expect(signal).toBeDefined()
    expect(signal?.aborted).toBe(false)
  })

  test("retries transient failures and eventually succeeds", async () => {
    let count = 0
    const fetch = (async () => {
      count += 1
      if (count < 3) throw new TypeError("network")
      return new Response(JSON.stringify({ healthy: true, version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, {
      retryCount: 2,
      retryDelayMs: 1,
    })

    expect(count).toBe(3)
    expect(result).toEqual({ healthy: true, version: "1.2.3" })
  })

  test("returns unhealthy when retries are exhausted", async () => {
    let count = 0
    const fetch = (async () => {
      count += 1
      throw new TypeError("network")
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, {
      retryCount: 2,
      retryDelayMs: 1,
    })

    expect(count).toBe(15)
    expect(result).toEqual({ healthy: false, requiresAuth: false, authFailed: false })
  })

  test("/health returning 401 and /global/health returning 200 reports healthy and visits both probes", async () => {
    const paths: string[] = []
    const fetch = (async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
      paths.push(url.pathname)
      if (url.pathname === "/health") return new Response(null, { status: 401 })
      if (url.pathname === "/global/health") return Response.json({ healthy: true, version: "1.2.3" })
      return new Response(null, { status: 404 })
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch)

    expect(result).toEqual({ healthy: true, version: "1.2.3" })
    expect("requiresAuth" in result).toBe(false)
    expect(paths).toEqual(["/health", "/global/health"])
  })

  test("all supported endpoints returning 401 without credentials requires auth but does not report auth failure", async () => {
    const paths: string[] = []
    const fetch = (async (input: RequestInfo | URL) => {
      const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
      paths.push(url.pathname)
      return new Response(null, { status: 401 })
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, { retryCount: 0 })

    expect(result).toEqual({ healthy: false, requiresAuth: true, authFailed: false })
    expect(paths.slice(0, 3)).toEqual(["/health", "/global/health", "/api/health"])
  })

  test("all supported endpoints returning 401 with credentials reports auth failure and sends an Authorization header", async () => {
    const paths: string[] = []
    let authHeader: string | undefined
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
      paths.push(url.pathname)
      if (paths.length === 1) authHeader = headerValue(init, "Authorization")
      return new Response(null, { status: 401 })
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(
      { url: server.url, username: "opencode", password: "secret" },
      fetch,
      { retryCount: 0 },
    )

    expect(result).toEqual({ healthy: false, requiresAuth: true, authFailed: true })
    expect(paths.slice(0, 3)).toEqual(["/health", "/global/health", "/api/health"])
    expect(authHeader?.startsWith("Basic ")).toBe(true)
  })

  test("public endpoint returning 200 without credentials does not send an Authorization header", async () => {
    let authHeader: string | undefined
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
      if (url.pathname === "/health") authHeader = headerValue(init, "Authorization")
      return Response.json({ healthy: true })
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch)

    expect(result).toEqual({ healthy: true })
    expect(authHeader).toBeUndefined()
  })

  test("public endpoint returning 200 with default username but blank password does not send an Authorization header", async () => {
    let authHeader: string | undefined
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
      if (url.pathname === "/health") authHeader = headerValue(init, "Authorization")
      return Response.json({ healthy: true })
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth({ url: server.url, username: "opencode" }, fetch)

    expect(result).toEqual({ healthy: true })
    expect(authHeader).toBeUndefined()
  })

  test("protected endpoint with correct credentials sends a Basic Authorization header and reports healthy", async () => {
    let authHeader: string | undefined
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input : new URL(input instanceof Request ? input.url : input)
      if (url.pathname === "/health") authHeader = headerValue(init, "Authorization")
      if (!headerValue(init, "Authorization")?.startsWith("Basic ")) return new Response(null, { status: 401 })
      return Response.json({ healthy: true })
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth({ url: server.url, username: "admin", password: "secret" }, fetch)

    expect(result).toEqual({ healthy: true })
    expect(authHeader?.startsWith("Basic ")).toBe(true)
  })

  test("protected endpoint with wrong credentials reports auth failure", async () => {
    const fetch = (async () => new Response(null, { status: 401 })) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(
      { url: server.url, username: "admin", password: "wrong" },
      fetch,
      { retryCount: 0 },
    )

    expect(result).toEqual({ healthy: false, requiresAuth: true, authFailed: true })
  })

  test("network failure without any auth response is unreachable, not auth-required", async () => {
    const fetch = (async () => {
      throw new TypeError("network")
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, { retryCount: 0 })

    expect(result).toEqual({ healthy: false, requiresAuth: false, authFailed: false })
  })
})
