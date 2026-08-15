import { describe, expect, test } from "bun:test"
import { detectServerProtocol } from "./server-protocol"

const server = { url: "http://localhost:4096" }
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
const mockFetch = (run: (input: string | URL | Request) => Promise<Response>) =>
  Object.assign(run, { preconnect: globalThis.fetch.preconnect })

describe("detectServerProtocol", () => {
  test("prefers the current project contract when both API generations exist", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/project") return Promise.resolve(json([{ id: "global", worktree: "/" }]))
      if (path === "/global/health") return Promise.resolve(json({ healthy: true, version: "1.18.4" }))
      return Promise.resolve(json({ healthy: true, version: "2.0.0", pid: 123 }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v2")
  })

  test("recognizes V2 health by its process identifier", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return Promise.resolve(json({}, 404))
      if (path === "/health") return Promise.resolve(json({}, 404))
      return Promise.resolve(json({ healthy: true, version: "2.0.0", pid: 123 }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v2")
  })

  test("recognizes the transitional V1 API health response", async () => {
    const fetcher = mockFetch((input) => {
      const path = new URL(input instanceof Request ? input.url : input).pathname
      if (path === "/global/health") return Promise.resolve(json({}, 404))
      return Promise.resolve(json({ healthy: true }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v1")
  })

  test.each([
    ["timeout", () => Promise.reject(new DOMException("timeout", "TimeoutError"))],
    ["fetch rejection", () => Promise.reject(new TypeError("network"))],
    ["html 200", () => Promise.resolve(new Response("<html>SPA</html>", { status: 200, headers: { "content-type": "text/html" } }))],
    ["invalid JSON 200", () => Promise.resolve(new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }))],
    ["404", () => Promise.resolve(json({}, 404))],
    ["500", () => Promise.resolve(json({}, 500))],
  ])("returns unknown for inconclusive %s probes", async (_name, response) => {
    const fetcher = mockFetch(() => response())
    expect(await detectServerProtocol(server, fetcher)).toBe("unknown")
  })

  test("re-evaluates a server that becomes available", async () => {
    let available = false
    const fetcher = mockFetch((input) => {
      if (!available) return Promise.reject(new TypeError("offline"))
      const path = new URL(input instanceof Request ? input.url : input).pathname
      return path === "/project" ? Promise.resolve(json([{ id: "global", worktree: "/" }])) : Promise.resolve(json({}, 404))
    })
    expect(await detectServerProtocol(server, fetcher)).toBe("unknown")
    available = true
    expect(await detectServerProtocol(server, fetcher)).toBe("v2")
  })
})
