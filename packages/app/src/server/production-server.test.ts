import { describe, expect, test } from "bun:test"
import { createProductionApp, createProductionServerOptions, nodeResponse } from "./production-server"

const app = createProductionApp()

describe("production Web UI server", () => {
  test("serves the built SPA and client-side routes", async () => {
    const root = await app.request("http://localhost/")
    const deepLink = await app.request("http://localhost/session/demo")

    expect(root.status).toBe(200)
    expect(root.headers.get("content-type")).toContain("text/html")
    expect(deepLink.status).toBe(200)
    expect(deepLink.headers.get("content-type")).toContain("text/html")
  })

  test("does not expose Vite development modules", async () => {
    for (const path of ["/@vite/client", "/src/context/server.tsx", "/node_modules/.vite/deps/"]) {
      const response = await app.request(`http://localhost${path}`)
      expect(response.status).toBe(404)
    }
  })

  test("routes control-plane APIs through the unified runtime", async () => {
    const response = await app.request("http://localhost/api/opencode/servers")
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toHaveProperty("servers")
  })

  test("does not commit headers before an async handler writes the response", async () => {
    const { response, responseReady } = nodeResponse()
    response.setHeader("x-request-id", "req_test")
    const committedHeaders = responseReady.then((value) => value.headers)

    await Promise.resolve()
    response.setHeader("content-type", "application/json; charset=utf-8")
    response.end("{}")

    expect((await committedHeaders).get("content-type")).toBe("application/json; charset=utf-8")
  })

  test("disables Bun's default idle timeout for long-lived SSE responses", () => {
    const options = createProductionServerOptions(app, "127.0.0.1", 3000)

    expect(options.idleTimeout).toBe(0)
  })
})
