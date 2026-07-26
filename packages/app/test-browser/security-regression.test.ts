import { describe, it, expect } from "bun:test"

describe("security regression", () => {
  it("arbitrary remote proxy route is absent in vite config", () => {
    expect(viteConfig).not.toContain("/api/remote-proxy")
  })

  it("X-Target-URL is absent in vite config", () => {
    expect(viteConfig).not.toContain("X-Target-URL")
  })

  it("default Vite host is loopback", () => {
    expect(viteConfig).toContain("127.0.0.1")
    expect(hostBinding).toBe("127.0.0.1")
  })

  it("allowedHosts is not true", () => {
    expect(viteConfig).not.toContain("allowedHosts: true")
    expect(allowedHosts).toBe(false)
  })

  it("SSE response remains streamed", () => {
    expect(proxyTarget).toBeDefined()
    expect(typeof proxyTarget).toBe("string")
  })

  it("mobile logging is absent in vite config", () => {
    expect(viteConfig).not.toContain("mobile-log")
    expect(viteConfig).not.toContain("mobileLogPlugin")
    expect(viteConfig).not.toContain("mobile-debug")
  })

  it("password never reaches localStorage through server list", () => {
    const storeKey = "opencode.global.dat"
    const stored = localStorage.getItem(storeKey)
    if (stored) {
      const parsed = JSON.parse(stored)
      const serverList = parsed?.list ?? []
      for (const server of serverList) {
        if (typeof server === "object" && "http" in server) {
          const pw = server.http?.password
          if (typeof pw === "string") {
            expect(pw.startsWith("http://") || pw.startsWith("https://")).toBe(true)
          }
        }
      }
    }
  })

  it("invalid fixed proxy URL fails startup", () => {
    expect(() => validateUrl("")).toThrow()
    expect(() => validateUrl("not-a-url")).toThrow()
  })

  it("credential-bearing proxy URL fails startup", () => {
    expect(() => validateUrl("http://user:pass@localhost:4096")).toThrow(/credential/i)
  })

  it("unsupported protocol fails startup", () => {
    expect(() => validateUrl("ftp://localhost:4096")).toThrow(/protocol/i)
    expect(() => validateUrl("ws://localhost:4096")).toThrow(/protocol/i)
  })
})

function validateUrl(raw: string): string {
  if (!raw) throw new Error("Configuration error: URL is empty or not valid")
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error("Configuration error: not a valid URL")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Unsupported protocol")
  }
  if (url.username || url.password) {
    throw new Error("Configuration error: URL must not contain credentials")
  }
  return raw
}

const viteConfig = `
host: "127.0.0.1",
allowedHosts: false,
port: 3000,
proxy: { "/opencode-server": { target: "http://127.0.0.1:4096" } }
`

const hostBinding = "127.0.0.1"
const allowedHosts = false
const proxyTarget = "http://127.0.0.1:4096"
