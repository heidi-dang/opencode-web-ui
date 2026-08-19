import { describe, expect, test } from "bun:test"
import {
  listServers,
  normalizeBaseUrl,
  probeRegisteredServer,
  publicServer,
  registerServer,
  resetRegistryForTests,
} from "./server-registry"

describe("server registry", () => {
  test("normalizes safe URLs and preserves reverse proxy paths", () => {
    expect(normalizeBaseUrl("https://HOST.example/opencode///")).toBe("https://host.example/opencode")
    expect(() => normalizeBaseUrl("https://user:pass@example.com")).toThrow("UNSAFE_SERVER_URL")
    expect(() => normalizeBaseUrl("ftp://example.com")).toThrow("UNSUPPORTED_URL_SCHEME")
  })

  test("creates opaque stable ids and redacts credentials", async () => {
    resetRegistryForTests()
    const server = await registerServer({ baseUrl: "https://tail.example/opencode", password: "secret" })
    expect(server.id).toMatch(/^srv_[a-f0-9]+$/)
    expect(server.id).not.toContain(server.baseUrl)
    expect(publicServer(server)).not.toHaveProperty("password")
  })

  test("ignores the legacy wildcard allowlist when no registry is configured", async () => {
    process.env.OPENCODE_SERVERS_STORE = `/tmp/opencode-registry-wildcard-test-${process.pid}.json`
    delete process.env.OPENCODE_SERVERS_CONFIG
    process.env.OPENCODE_ALLOWED_SERVERS = "*"
    resetRegistryForTests()

    await expect(listServers()).resolves.toEqual([])
  })

  test("refreshes credentials when registering an existing runtime URL", async () => {
    process.env.OPENCODE_SERVERS_STORE = `/tmp/opencode-registry-duplicate-${process.pid}.json`
    delete process.env.OPENCODE_SERVERS_CONFIG
    delete process.env.OPENCODE_ALLOWED_SERVERS
    resetRegistryForTests()

    const first = await registerServer({ baseUrl: "https://tail.example/opencode", username: "old-user", password: "old-pass" })
    const second = await registerServer({ name: "Updated", baseUrl: "https://tail.example/opencode", username: "new-user", password: "new-pass" })

    expect(second.id).toBe(first.id)
    expect(second.name).toBe("Updated")
    expect(second.username).toBe("new-user")
    expect(second.password).toBe("new-pass")
    expect(second.state).toBe("REGISTERED")
  })

  test("preserves authentication failures instead of reporting an unknown protocol", async () => {
    process.env.OPENCODE_SERVERS_STORE = `/tmp/opencode-registry-auth-${process.pid}.json`
    delete process.env.OPENCODE_SERVERS_CONFIG
    delete process.env.OPENCODE_ALLOWED_SERVERS
    process.env.OPENCODE_ALLOWED_SERVERS = "https://auth.example"
    resetRegistryForTests()
    const server = await registerServer({ baseUrl: "https://auth.example", username: "user", password: "password" })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response("Unauthorized", { status: 401 })) as unknown as typeof fetch

    try {
      const result = await probeRegisteredServer(server)
      expect(result).toMatchObject({
        serverId: server.id,
        reachable: true,
        authenticated: false,
        healthy: false,
        state: "AUTH_FAILED",
        error: "AUTH_FAILED",
      })
      expect(result.protocol).toBeUndefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("uses manual redirects for health probes", async () => {
    process.env.OPENCODE_SERVERS_STORE = `/tmp/opencode-registry-redirect-${process.pid}.json`
    delete process.env.OPENCODE_SERVERS_CONFIG
    process.env.OPENCODE_ALLOWED_SERVERS = "https://redirect.example"
    resetRegistryForTests()
    const server = await registerServer({ baseUrl: "https://redirect.example" })
    const originalFetch = globalThis.fetch
    let redirect: RequestRedirect | undefined
    globalThis.fetch = (async (_input, init) => {
      redirect = init?.redirect
      return new Response(null, { status: 404 })
    }) as unknown as typeof fetch
    try {
      await probeRegisteredServer(server)
      expect(redirect).toBe("manual")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
