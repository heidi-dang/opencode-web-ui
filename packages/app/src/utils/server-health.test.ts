import { describe, expect, test } from "bun:test"
import type { ServerConnection } from "@/context/server"
import { checkServerHealth } from "./server-health"

const server: ServerConnection.HttpBase = {
  url: "http://localhost:4096",
}

function abortFromInput(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.signal) return init.signal
  if (input instanceof Request) return input.signal
  return undefined
}

describe("checkServerHealth", () => {
  test("rejects an SPA HTML fallback", async () => {
    const fetch = (async () => new Response("<html>SPA</html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof globalThis.fetch
    const result = await checkServerHealth(server, fetch, { retryCount: 0 })
    expect(result.healthy).toBe(false)
  })

  test("rejects arbitrary JSON and empty successful responses", async () => {
    for (const response of [
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }),
      new Response(null, { status: 200, headers: { "content-type": "application/json" } }),
    ]) {
      const fetch = (async () => response.clone()) as unknown as typeof globalThis.fetch
      expect((await checkServerHealth(server, fetch, { retryCount: 0 })).healthy).toBe(false)
    }
  })

  test("distinguishes an authenticated endpoint", async () => {
    const fetch = (async () => new Response("unauthorized", { status: 401 })) as unknown as typeof globalThis.fetch
    await expect(checkServerHealth(server, fetch, { retryCount: 0 })).resolves.toMatchObject({
      healthy: false,
      requiresAuth: true,
    })
  })
  test("returns healthy response with version", async () => {
    let request: URL | undefined
    const fetch = (async (input: URL | RequestInfo, _init?: any) => {
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
    const fetch = (async (input: URL | RequestInfo, _init?: any) => {
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
    const fetch = (async (input: URL | RequestInfo, _init?: any) => {
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

    const fetch = (async (_input: URL | RequestInfo, _init?: any) =>
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
    const fetch = (async (_input: URL | RequestInfo, _init?: any) => {
      throw new Error("network")
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch)

    expect(result).toEqual({ healthy: false, unreachable: true })
  })

  test("uses timeout fallback when AbortSignal.timeout is unavailable", async () => {
    const timeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout")
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      value: undefined,
    })

    let aborted = false
    const fetch = (async (input: URL | RequestInfo, init?: any) => {
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
    expect(result).toEqual({ healthy: false, unreachable: true })
  })

  test("uses provided abort signal", async () => {
    let signal: AbortSignal | undefined
    const fetch = (async (input: URL | RequestInfo, init?: any) => {
      const currentSignal = abortFromInput(input, init)
      if (currentSignal) signal = currentSignal
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
    const fetch = (async (_input: URL | RequestInfo, _init?: any) => {
      count += 1
      // The 3rd attempt succeeds on /health, and the 4th is the /api/model/default fetch
      if (count <= 2) throw new TypeError("network")
      return new Response(JSON.stringify({ healthy: true, version: "1.2.3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, {
      retryCount: 2,
      retryDelayMs: 1,
    })

    expect(count).toBeGreaterThanOrEqual(3)
    expect(result).toEqual({ healthy: true, version: "1.2.3" })
  })

  test("returns unhealthy when retries are exhausted", async () => {
    let count = 0
    const fetch = (async (_input: URL | RequestInfo, _init?: any) => {
      count += 1
      throw new TypeError("network")
    }) as unknown as typeof globalThis.fetch

    const result = await checkServerHealth(server, fetch, {
      retryCount: 2,
      retryDelayMs: 1,
    })

    expect(count).toBe(15)
    expect(result).toEqual({ healthy: false, unreachable: true })
  })
})
