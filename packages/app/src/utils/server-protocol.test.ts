import { describe, expect, test } from "bun:test"
import { detectServerProtocol, ServerProtocolError } from "./server-protocol"

const server = { url: "http://localhost:4096" }
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
const mockFetch = (run: (input: string | URL | Request) => Promise<Response>) =>
  Object.assign(run, { preconnect: globalThis.fetch.preconnect })

describe("detectServerProtocol", () => {
  test("prefers the native API when both API generations exist", async () => {
    const fetcher = mockFetch((input) => {
      const path = input instanceof Request ? input.url : String(input)
      if (path.includes("/global/health")) return Promise.resolve(json({ healthy: true, version: "1.18.4" }))
      return Promise.resolve(json({ healthy: true, state: "READY", protocol: "v2", version: "2.0.0", pid: 123 }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v2")
  })

  test("recognizes V2 health by its process identifier", async () => {
    const fetcher = mockFetch((input) => {
      const path = input instanceof Request ? input.url : String(input)
      if (path.includes("/global/health")) return Promise.resolve(json({}, 404))
      return Promise.resolve(json({ healthy: true, protocol: "v2", version: "2.0.0", pid: 123 }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v2")
  })

  test("recognizes the legacy health response only after native probing fails", async () => {
    const fetcher = mockFetch((input) => {
      const path = input instanceof Request ? input.url : String(input)
      if (path.includes("/api/health")) return Promise.resolve(json({}, 404))
      return Promise.resolve(json({ healthy: true }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v1")
  })

  test("does not guess when neither protocol is identifiable", async () => {
    const fetcher = mockFetch(() => Promise.resolve(json({ healthy: false })))
    expect(await detectServerProtocol(server, fetcher)).toBe("unknown")
  })

  test("uses the same-origin gateway for registered browser servers", async () => {
    const previous = globalThis.window
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { origin: "https://web.example.test" } },
    })
    const requests: string[] = []
    const fetcher = mockFetch((input) => {
      const url = input instanceof Request ? input.url : String(input)
      requests.push(url)
      return Promise.resolve(json({ healthy: true, state: "READY", protocol: "v2", version: "2.0.0", pid: 123 }))
    })
    try {
      expect(await detectServerProtocol({ ...server, id: "srv_test" }, fetcher)).toBe("v2")
      expect(requests[0]).toBe("/api/opencode/servers/srv_test/health")
      expect(requests[0]).not.toContain("localhost:4096")
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: previous })
    }
  })

  test("accepts the control-plane health response shape for registered browser servers", async () => {
    const previous = globalThis.window
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { origin: "https://web.example.test" } },
    })
    const fetcher = mockFetch(() =>
      Promise.resolve(
        json({
          server: { state: "READY", protocol: "v2" },
          health: { healthy: true, authenticated: true, reachable: true, protocol: "v2" },
        }),
      ),
    )
    try {
      await expect(detectServerProtocol({ ...server, id: "srv_health_shape" }, fetcher)).resolves.toBe("v2")
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: previous })
    }
  })

  test("surfaces a registered gateway 401 as AUTH_FAILED", async () => {
    const previous = globalThis.window
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { origin: "https://web.example.test" } },
    })
    const fetcher = mockFetch(() => Promise.resolve(json({ error: "AUTH_FAILED" }, 502)))
    try {
      await expect(detectServerProtocol({ ...server, id: "srv_auth" }, fetcher)).rejects.toMatchObject({ code: "AUTH_FAILED" })
      await expect(detectServerProtocol({ ...server, id: "srv_auth" }, fetcher)).rejects.toBeInstanceOf(ServerProtocolError)
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: previous })
    }
  })
})
