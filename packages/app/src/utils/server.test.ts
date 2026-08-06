import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, getEffectiveServerUrl } from "./server"

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

describe("authTokenFromCredentials", () => {
  test("encodes credentials with the default username", () => {
    expect(authTokenFromCredentials({ password: "secret" })).toBe(btoa("opencode:secret"))
  })
})

describe("getEffectiveServerUrl", () => {
  test("returns original URL when not in https or url is empty", () => {
    expect(getEffectiveServerUrl("http://100.97.224.96:4096")).toBe("http://100.97.224.96:4096")
  })

  test("validates ports before constructing direct proxy URLs", () => {
    // Simulate https environment
    const originalLocation = globalThis.location
    try {
      // @ts-ignore
      delete globalThis.location
      // @ts-ignore
      globalThis.location = { protocol: "https:", origin: "https://ai.tnaprovider.com.au" }

      const { getEffectiveServerUrl: getEffective } = require("./server")

      // Out of range port should not be rewritten
      expect(getEffective("http://100.97.224.96:0")).toBe("http://100.97.224.96:0")
      expect(getEffective("http://100.97.224.96:66666")).toBe("http://100.97.224.96:66666")
      // Valid 1-digit port should be rewritten
      expect(getEffective("http://100.97.224.96:6")).toBe("https://ai.tnaprovider.com.au/direct/100.97.224.96/6")
      // Valid port should generate clean /direct/ URL
      expect(getEffective("http://100.97.224.96:4096")).toBe("https://ai.tnaprovider.com.au/direct/100.97.224.96/4096")
    } finally {
      globalThis.location = originalLocation
    }
  })
})
