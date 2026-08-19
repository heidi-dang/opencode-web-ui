import { describe, expect, test } from "bun:test"
import { createProductionApp, createProductionServerOptions, nodeResponse } from "./production-server"

const app = createProductionApp()

describe("production Web UI server", () => {
  test("rejects anonymous requests when production basic auth is enabled", async () => {
    const previous = {
      mode: process.env.WEBUI_AUTH_MODE,
      username: process.env.WEBUI_AUTH_USERNAME,
      passwordHash: process.env.WEBUI_AUTH_PASSWORD_HASH,
    }
    process.env.WEBUI_AUTH_MODE = "basic"
    process.env.WEBUI_AUTH_USERNAME = "operator"
    process.env.WEBUI_AUTH_PASSWORD_HASH = "scrypt$16384$8$1$test-salt$eYjcyBJhwWVEd3yaEKOow5fvCtWmQjAZsuccH_1rqR4"
    try {
      const response = await createProductionApp().request("http://localhost/api/bootstrap")
      expect(response.status).toBe(401)
      expect(response.headers.get("www-authenticate")).toBe("Basic realm=web-ui")
    } finally {
      if (previous.mode === undefined) delete process.env.WEBUI_AUTH_MODE
      else process.env.WEBUI_AUTH_MODE = previous.mode
      if (previous.username === undefined) delete process.env.WEBUI_AUTH_USERNAME
      else process.env.WEBUI_AUTH_USERNAME = previous.username
      if (previous.passwordHash === undefined) delete process.env.WEBUI_AUTH_PASSWORD_HASH
      else process.env.WEBUI_AUTH_PASSWORD_HASH = previous.passwordHash
    }
  })

  test("allows only the configured basic-auth credentials", async () => {
    const previous = {
      mode: process.env.WEBUI_AUTH_MODE,
      username: process.env.WEBUI_AUTH_USERNAME,
      passwordHash: process.env.WEBUI_AUTH_PASSWORD_HASH,
    }
    process.env.WEBUI_AUTH_MODE = "basic"
    process.env.WEBUI_AUTH_USERNAME = "operator"
    process.env.WEBUI_AUTH_PASSWORD_HASH = "scrypt$16384$8$1$test-salt$eYjcyBJhwWVEd3yaEKOow5fvCtWmQjAZsuccH_1rqR4"
    try {
      const wrong = await createProductionApp().request("http://localhost/api/bootstrap", { headers: { authorization: "Basic b3BlcmF0b3I6d3Jvbmc=" } })
      const right = await createProductionApp().request("http://localhost/api/bootstrap", { headers: { authorization: "Basic b3BlcmF0b3I6c2VjcmV0" } })
      expect(wrong.status).toBe(401)
      expect(right.status).not.toBe(401)
    } finally {
      if (previous.mode === undefined) delete process.env.WEBUI_AUTH_MODE
      else process.env.WEBUI_AUTH_MODE = previous.mode
      if (previous.username === undefined) delete process.env.WEBUI_AUTH_USERNAME
      else process.env.WEBUI_AUTH_USERNAME = previous.username
      if (previous.passwordHash === undefined) delete process.env.WEBUI_AUTH_PASSWORD_HASH
      else process.env.WEBUI_AUTH_PASSWORD_HASH = previous.passwordHash
    }
  })

  test("rejects malformed authorization without exposing details", async () => {
    const previous = {
      mode: process.env.WEBUI_AUTH_MODE,
      username: process.env.WEBUI_AUTH_USERNAME,
      passwordHash: process.env.WEBUI_AUTH_PASSWORD_HASH,
    }
    process.env.WEBUI_AUTH_MODE = "basic"
    process.env.WEBUI_AUTH_USERNAME = "operator"
    process.env.WEBUI_AUTH_PASSWORD_HASH = "scrypt$16384$8$1$test-salt$eYjcyBJhwWVEd3yaEKOow5fvCtWmQjAZsuccH_1rqR4"
    try {
      const response = await createProductionApp().request("http://localhost/api/opencode/servers", { method: "POST", headers: { authorization: "Bearer secret" }, body: "{}" })
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({ error: "AUTH_REQUIRED" })
    } finally {
      if (previous.mode === undefined) delete process.env.WEBUI_AUTH_MODE
      else process.env.WEBUI_AUTH_MODE = previous.mode
      if (previous.username === undefined) delete process.env.WEBUI_AUTH_USERNAME
      else process.env.WEBUI_AUTH_USERNAME = previous.username
      if (previous.passwordHash === undefined) delete process.env.WEBUI_AUTH_PASSWORD_HASH
      else process.env.WEBUI_AUTH_PASSWORD_HASH = previous.passwordHash
    }
  })

  test("fails closed when production auth is required but not configured", async () => {
    const previous = {
      required: process.env.WEBUI_AUTH_REQUIRED,
      mode: process.env.WEBUI_AUTH_MODE,
      username: process.env.WEBUI_AUTH_USERNAME,
      passwordHash: process.env.WEBUI_AUTH_PASSWORD_HASH,
    }
    process.env.WEBUI_AUTH_REQUIRED = "1"
    delete process.env.WEBUI_AUTH_MODE
    delete process.env.WEBUI_AUTH_USERNAME
    delete process.env.WEBUI_AUTH_PASSWORD_HASH
    try {
      const response = await createProductionApp().request("http://localhost/")
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: "AUTH_MISCONFIGURED" })
    } finally {
      if (previous.required === undefined) delete process.env.WEBUI_AUTH_REQUIRED
      else process.env.WEBUI_AUTH_REQUIRED = previous.required
      if (previous.mode === undefined) delete process.env.WEBUI_AUTH_MODE
      else process.env.WEBUI_AUTH_MODE = previous.mode
      if (previous.username === undefined) delete process.env.WEBUI_AUTH_USERNAME
      else process.env.WEBUI_AUTH_USERNAME = previous.username
      if (previous.passwordHash === undefined) delete process.env.WEBUI_AUTH_PASSWORD_HASH
      else process.env.WEBUI_AUTH_PASSWORD_HASH = previous.passwordHash
    }
  })

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

  test("reports bounded stream saturation and emits drain after the consumer reads", async () => {
    const { response, responseReady } = nodeResponse()
    const drained = new Promise<void>((resolve) => response.once("drain", resolve))
    let accepted = 0
    let saturated = false
    for (; accepted < 64; accepted++) {
      if (!response.write(`chunk-${accepted}`)) {
        saturated = true
        break
      }
    }
    expect(accepted).toBeGreaterThan(0)
    expect(saturated).toBe(true)

    const streamResponse = await responseReady
    const reader = streamResponse.body!.getReader()
    await reader.read()
    await drained
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(response.write("resumed")).toBe(false)
    expect((await reader.read()).done).toBe(false)
    await reader.cancel()
  })

  test("disables Bun's default idle timeout for long-lived SSE responses", () => {
    const options = createProductionServerOptions(app, "127.0.0.1", 3000)

    expect(options.idleTimeout).toBe(0)
  })
})
