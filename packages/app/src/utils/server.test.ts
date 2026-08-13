import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, createSdkForServer, getEffectiveServerUrl } from "./server"

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
      Object.defineProperty(globalThis, "location", {
        value: { protocol: "https:", origin: "https://ai.tnaprovider.com.au" },
        configurable: true
      })

      const { getEffectiveServerUrl: getEffective } = require("./server")

      // Out of range port should not be rewritten
      expect(getEffective("http://100.97.224.96:0")).toBe("http://100.97.224.96:0")
      expect(getEffective("http://100.97.224.96:66666")).toBe("http://100.97.224.96:66666")
      // Valid 1-digit port should be rewritten
      expect(getEffective("http://100.97.224.96:6")).toBe("https://ai.tnaprovider.com.au/direct/100.97.224.96/6")
      // Valid port should generate clean /direct/ URL
      expect(getEffective("http://100.97.224.96:4096")).toBe("https://ai.tnaprovider.com.au/direct/100.97.224.96/4096")
    } finally {
      Object.defineProperty(globalThis, "location", {
        value: originalLocation,
        configurable: true
      })
    }
  })

  test("migrates a persisted same-origin HTTPS server to the backend proxy path", () => {
    const originalLocation = globalThis.location
    try {
      Object.defineProperty(globalThis, "location", {
        value: { protocol: "https:", origin: "https://ai.tnaprovider.com.au", href: "https://ai.tnaprovider.com.au/" },
        configurable: true,
      })
      const { getEffectiveServerUrl: getEffective } = require("./server")
      expect(getEffective("https://ai.tnaprovider.com.au")).toBe("https://ai.tnaprovider.com.au/opencode-server")
    } finally {
      Object.defineProperty(globalThis, "location", { value: originalLocation, configurable: true })
    }
  })
})

test("proxy path rewrites materialize Request bodies for WebKit uploads", async () => {
  let capturedInput: RequestInfo | URL | undefined
  let capturedInit: RequestInit | undefined
  const fetcher = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedInput = input
      capturedInit = init
      return new Response(undefined, { status: 204 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const client = createSdkForServer({
    server: { url: "http://localhost:4096/proxy/base" },
    fetch: fetcher,
    directory: "/repo",
    throwOnError: true,
  })

  await client.session.promptAsync({
    sessionID: "ses_1",
    parts: [{ type: "text", text: "hello" }],
  })

  expect(capturedInput).toBe("http://localhost:4096/proxy/base/session/ses_1/prompt_async")
  expect(capturedInit?.body).toBeInstanceOf(ArrayBuffer)
  expect(JSON.parse(new TextDecoder().decode(capturedInit?.body as ArrayBuffer))).toMatchObject({
    parts: [{ type: "text", text: "hello" }],
  })
})
