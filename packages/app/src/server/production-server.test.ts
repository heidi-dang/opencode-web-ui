import { describe, expect, test } from "bun:test"
import { createProductionApp } from "./production-server"

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
})
