import { describe, expect, test } from "bun:test"
import { normalizeBaseUrl, publicServer, registerServer, resetRegistryForTests } from "./server-registry"

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
})
