import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, getProxyEndpoint } from "./server"

describe("authFromToken", () => {
  test("decodes basic auth credentials from auth_token", () => {
    expect(authFromToken(btoa("kit:secret"))).toEqual({ username: "kit", password: "secret" })
  })

  test("defaults blank username to opencode", () => {
    expect(authFromToken(btoa(":secret"))).toEqual({ username: "opencode", password: "secret" })
  })

  test("ignores malformed tokens", () => {
    expect(authFromToken("not base64")).toBeUndefined()
    expect(authFromToken(btoa("missing-separator"))).toBeUndefined()
  })
})

describe("getProxyEndpoint", () => {
  test("uses the gateway-issued server id and rejects missing registration", () => {
    const previous = globalThis.window
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "http://localhost:3000" } } })
    try {
      expect(getProxyEndpoint("https://tail.example/opencode", "/global/health", undefined, "srv_test")).toContain("serverId=srv_test")
      expect(() => getProxyEndpoint("https://tail.example/opencode", "/global/health")).toThrow("SERVER_REGISTRATION_REQUIRED")
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: previous })
    }
  })
})

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("opencode:secret"))
  })
})
