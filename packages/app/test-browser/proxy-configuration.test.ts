import { describe, it, expect } from "bun:test"

describe("proxy configuration", () => {
  it("rejects proxy URL with unsupported protocol", () => {
    const urls = ["ftp://opencode.ai:4096", "file:///tmp/socket", "ssh://opencode:22", "ws://localhost:4096"]
    for (const url of urls) {
      expect(() => validateProxyUrl(url)).toThrow(/unsupported protocol/i)
    }
  })

  it("rejects proxy URL with credentials", () => {
    const urls = [
      "http://user:pass@localhost:4096",
      "http://admin:secret123@192.168.1.1:4096",
      "https://user@opencode.ai:4096",
    ]
    for (const url of urls) {
      expect(() => validateProxyUrl(url)).toThrow(/credential/i)
    }
  })

  it("rejects invalid proxy URL syntax", () => {
    const urls = ["", "not-a-url", "http://", "://host", "http://:port"]
    for (const url of urls) {
      expect(() => validateProxyUrl(url)).toThrow(/valid url/i)
    }
  })

  it("accepts valid proxy URL without credentials", () => {
    const urls = [
      "http://localhost:4096",
      "http://127.0.0.1:4096",
      "https://remote-server.example.com:4096",
      "http://192.168.1.100:8080",
    ]
    for (const url of urls) {
      expect(() => validateProxyUrl(url)).not.toThrow()
    }
  })

  it("preserves target pathname", () => {
    const result = validateProxyUrl("http://localhost:4096/api/v1")
    expect(result).toBe("http://localhost:4096/api/v1")
  })

  it("allows VITE_OPENCODE_SERVER_PORT fallback when VITE_OPENCODE_SERVER_URL is unset", () => {
    const result = resolveProxyTarget(undefined, "4096")
    expect(result).toBe("http://127.0.0.1:4096")
  })

  it("uses VITE_OPENCODE_SERVER_URL when set", () => {
    const result = resolveProxyTarget("http://remote:8080", "4096")
    expect(result).toBe("http://remote:8080")
  })
})

function validateProxyUrl(raw: string): string {
  if (!raw) throw new Error("Configuration error: VITE_OPENCODE_SERVER_URL is empty or not a valid URL")
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Configuration error: VITE_OPENCODE_SERVER_URL "${raw}" is not a valid URL`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Configuration error: Unsupported protocol "${url.protocol}" in VITE_OPENCODE_SERVER_URL`)
  }
  if (url.username || url.password) {
    throw new Error("Configuration error: VITE_OPENCODE_SERVER_URL must not contain credentials")
  }
  return raw
}

function resolveProxyTarget(url: string | undefined, port: string): string {
  if (url) return validateProxyUrl(url)
  return `http://127.0.0.1:${port}`
}
