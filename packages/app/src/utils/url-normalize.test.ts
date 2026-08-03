import { describe, expect, test } from "bun:test"
import {
  getEffectiveServerUrl,
  getEffectiveWebSocketUrl,
  normalizeServerUrl,
  parseServerEndpoint,
} from "./url-normalize"

describe("url-normalize", () => {
  test("normalizes canonical HTTP URL", () => {
    expect(normalizeServerUrl("http://100.111.125.40:4096")).toBe("http://100.111.125.40:4096")
  })

  test("normalizes canonical HTTPS URL", () => {
    expect(normalizeServerUrl("https://heidi-dev.ts.net:4096")).toBe("https://heidi-dev.ts.net:4096")
  })

  test("normalizes Tailscale MagicDNS hostname", () => {
    expect(normalizeServerUrl("heidi-dev:4096")).toBe("http://heidi-dev:4096")
    expect(normalizeServerUrl("http://heidi-dev:4096/")).toBe("http://heidi-dev:4096")
  })

  test("normalizes IPv4 with port", () => {
    expect(normalizeServerUrl("100.103.50.19:4096")).toBe("http://100.103.50.19:4096")
  })

  test("normalizes bracketed IPv6 with port", () => {
    expect(normalizeServerUrl("http://[2a09:bac2:188:3464::538:1a]:4096/")).toBe(
      "http://[2a09:bac2:188:3464::538:1a]:4096",
    )
  })

  test("strips trailing slashes and handles base paths", () => {
    expect(normalizeServerUrl("http://localhost:4096/opencode-server/")).toBe(
      "http://localhost:4096/opencode-server",
    )
  })

  test("rejects invalid protocols", () => {
    expect(normalizeServerUrl("ftp://100.111.125.40")).toBeUndefined()
    expect(normalizeServerUrl("ssh://heidi-dev")).toBeUndefined()
  })

  test("handles duplicate protocol prefixes", () => {
    expect(normalizeServerUrl("http://http://100.111.125.40:4096")).toBe("http://100.111.125.40:4096")
    expect(normalizeServerUrl("http://https://heidi-dev.ts.net:4096")).toBe("https://heidi-dev.ts.net:4096")
  })

  test("rejects query strings and fragments", () => {
    expect(normalizeServerUrl("http://100.111.125.40:4096?token=123")).toBeUndefined()
    expect(normalizeServerUrl("http://100.111.125.40:4096#section")).toBeUndefined()
  })

  test("derives WebSocket URLs correctly", () => {
    const httpEndpoint = parseServerEndpoint("http://100.111.125.40:4096")
    expect(httpEndpoint?.wsUrl).toBe("ws://100.111.125.40:4096")

    const httpsEndpoint = parseServerEndpoint("https://heidi-dev.ts.net:4096")
    expect(httpsEndpoint?.wsUrl).toBe("wss://heidi-dev.ts.net:4096")
  })

  test("derives effective proxy routing for hosted HTTPS origin", () => {
    const hostedOrigin = "https://ai.tnaprovider.com.au"

    // HTTP target gets proxied via /direct/<host>/<port>
    expect(getEffectiveServerUrl("http://100.111.125.40:4096", hostedOrigin)).toBe(
      "https://ai.tnaprovider.com.au/direct/100.111.125.40/4096",
    )

    // Same-origin target stays direct
    expect(getEffectiveServerUrl("https://ai.tnaprovider.com.au/opencode-server", hostedOrigin)).toBe(
      "https://ai.tnaprovider.com.au/opencode-server",
    )

    // WebSocket derivation over proxy
    expect(getEffectiveWebSocketUrl("http://100.111.125.40:4096", hostedOrigin)).toBe(
      "wss://ai.tnaprovider.com.au/direct/100.111.125.40/4096",
    )
  })

  test("preserves direct URLs when page origin is local HTTP", () => {
    const localOrigin = "http://localhost:3000"
    expect(getEffectiveServerUrl("http://100.111.125.40:4096", localOrigin)).toBe("http://100.111.125.40:4096")
  })
})
