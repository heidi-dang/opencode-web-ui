import { describe, expect, test } from "bun:test"
import { detectServerProtocol } from "./server-protocol"

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
      return Promise.resolve(json({ healthy: true, version: "2.0.0", pid: 123 }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v2")
  })

  test("recognizes V2 health by its process identifier", async () => {
    const fetcher = mockFetch((input) => {
      const path = input instanceof Request ? input.url : String(input)
      if (path.includes("/global/health")) return Promise.resolve(json({}, 404))
      return Promise.resolve(json({ healthy: true, version: "2.0.0", pid: 123 }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v2")
  })

  test("recognizes the legacy health response only after native probing fails", async () => {
    const fetcher = mockFetch((input) => {
      const path = input instanceof Request ? input.url : String(input)
      if (path.includes("/global/health")) return Promise.resolve(json({}, 404))
      return Promise.resolve(json({ healthy: true }))
    })

    expect(await detectServerProtocol(server, fetcher)).toBe("v1")
  })

  test("does not guess when neither protocol is identifiable", async () => {
    const fetcher = mockFetch(() => Promise.resolve(json({ healthy: false })))
    expect(await detectServerProtocol(server, fetcher)).toBe("unknown")
  })
})
