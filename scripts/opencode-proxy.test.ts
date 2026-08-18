import { describe, expect, test } from "bun:test"
import { handleRequest } from "./opencode-proxy"

function response() {
  return {
    headersSent: false,
    statusCode: 0,
    headers: new Map<string, string>(),
    body: "",
    setHeader(name: string, value: string) {
      this.headers.set(name, value)
    },
    end(value?: string) {
      this.body = value || ""
    },
  }
}

function request(url: string, method = "GET", body = "") {
  return {
    url,
    method,
    headers: { host: "localhost:8787" },
    async *[Symbol.asyncIterator]() {
      if (body) yield Buffer.from(body)
    },
  }
}

describe("standalone OpenCode proxy", () => {
  test("lists an empty registry when the legacy wildcard allowlist is configured", async () => {
    process.env.OPENCODE_SERVERS_STORE = "/tmp/opencode-proxy-entrypoint-test.json"
    delete process.env.OPENCODE_SERVERS_CONFIG
    process.env.OPENCODE_ALLOWED_SERVERS = "*"

    const res = response()
    await handleRequest(request("/api/opencode/servers") as any, res as any)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ servers: [] })
  })

  test("returns the latest v2 probe result when registering a server", async () => {
    process.env.OPENCODE_SERVERS_STORE = `/tmp/opencode-proxy-entrypoint-probe-${process.pid}.json`
    delete process.env.OPENCODE_SERVERS_CONFIG
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => Response.json({ healthy: true })

    try {
      const res = response()
      await handleRequest(
        request(
          "/api/opencode/servers",
          "POST",
          JSON.stringify({ name: "test", baseUrl: "https://api.example.test" }),
        ) as any,
        res as any,
      )

      const payload = JSON.parse(res.body)
      expect(res.statusCode).toBe(201)
      expect(payload.reachability).toBe("SERVER_READY")
      expect(payload.probe.protocol).toBe("v2")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("persists an auth failure without claiming the server is ready", async () => {
    process.env.OPENCODE_SERVERS_STORE = `/tmp/opencode-proxy-entrypoint-auth-${process.pid}.json`
    delete process.env.OPENCODE_SERVERS_CONFIG
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch

    try {
      const res = response()
      await handleRequest(
        request(
          "/api/opencode/servers",
          "POST",
          JSON.stringify({ name: "auth-test", baseUrl: "https://auth.example", username: "user", password: "wrong" }),
        ) as any,
        res as any,
      )

      const payload = JSON.parse(res.body)
      expect(res.statusCode).toBe(201)
      expect(payload.ready).toBe(false)
      expect(payload.probe.error).toBe("AUTH_FAILED")
      expect(payload.probe.state).toBe("AUTH_FAILED")
      expect(payload.server.state).toBe("AUTH_FAILED")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
