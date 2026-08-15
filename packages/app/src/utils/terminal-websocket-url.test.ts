import { describe, expect, test } from "bun:test"
import { terminalWebSocketURL } from "./terminal-websocket-url"

describe("terminalWebSocketURL", () => {
  test("uses the current ticketed PTY route", () => {
    const url = terminalWebSocketURL({
      url: "http://127.0.0.1:49365",
      id: "pty_test",
      directory: "/tmp/project",
      cursor: 0,
      ticket: "connect-ticket",
    })

    expect(url.protocol).toBe("ws:")
    expect(url.username).toBe("")
    expect(url.password).toBe("")
    expect(url.pathname).toBe("/api/pty/pty_test/connect")
    expect(url.searchParams.get("location[directory]")).toBe("/tmp/project")
    expect(url.searchParams.get("cursor")).toBe("0")
    expect(url.searchParams.get("ticket")).toBe("connect-ticket")
    expect(url.searchParams.has("auth_token")).toBe(false)
  })

  test("routes remote HTTPS-preview websocket traffic through the direct proxy", () => {
    const originalLocation = globalThis.location
    try {
      Object.defineProperty(globalThis, "location", {
        value: { protocol: "https:", origin: "https://preview.example.test", href: "https://preview.example.test/" },
        configurable: true,
      })
      const url = terminalWebSocketURL({
        protocol: "v2",
        url: "http://139.180.175.60:4096",
        id: "pty_test",
        directory: "/tmp/project",
        cursor: 0,
        password: "secret",
      })
      expect(url.protocol).toBe("wss:")
      expect(url.host).toBe("preview.example.test")
      expect(url.pathname).toBe("/direct/139.180.175.60/4096/api/pty/pty_test/connect")
      expect(url.searchParams.get("auth_token")).toBe(btoa("opencode:secret"))
    } finally {
      Object.defineProperty(globalThis, "location", { value: originalLocation, configurable: true })
    }
  })

  test("uses query auth without embedding credentials in websocket URL for v1", () => {
    const url = terminalWebSocketURL({
      protocol: "v1",
      url: "http://127.0.0.1:49365",
      id: "pty_test",
      directory: "/tmp/project",
      cursor: 0,
      sameOrigin: false,
      username: "opencode",
      password: "secret",
    })

    expect(url.protocol).toBe("ws:")
    expect(url.username).toBe("")
    expect(url.password).toBe("")
    expect(url.pathname).toBe("/pty/pty_test/connect")
    expect(url.searchParams.get("directory")).toBe("/tmp/project")
    expect(url.searchParams.get("auth_token")).toBe(btoa("opencode:secret"))
  })

  test("omits query auth for same-origin saved credentials for v1", () => {
    const url = terminalWebSocketURL({
      protocol: "v1",
      url: "https://app.example.test",
      id: "pty_test",
      directory: "/tmp/project",
      cursor: 10,
      sameOrigin: true,
      username: "opencode",
      password: "secret",
    })

    expect(url.protocol).toBe("wss:")
    expect(url.pathname).toBe("/pty/pty_test/connect")
    expect(url.searchParams.get("directory")).toBe("/tmp/project")
    expect(url.searchParams.has("auth_token")).toBe(false)
  })

  test("uses query auth for same-origin credentials from auth_token for v1", () => {
    const url = terminalWebSocketURL({
      protocol: "v1",
      url: "https://app.example.test",
      id: "pty_test",
      directory: "/tmp/project",
      cursor: 10,
      sameOrigin: true,
      username: "opencode",
      password: "secret",
      authToken: true,
    })

    expect(url.protocol).toBe("wss:")
    expect(url.pathname).toBe("/pty/pty_test/connect")
    expect(url.searchParams.get("directory")).toBe("/tmp/project")
    expect(url.searchParams.get("auth_token")).toBe(btoa("opencode:secret"))
  })

  test("uses query auth for same-origin credentials from auth_token for v2", () => {
    const url = terminalWebSocketURL({
      protocol: "v2",
      url: "https://app.example.test",
      id: "pty_test",
      directory: "/tmp/project",
      cursor: 10,
      sameOrigin: true,
      username: "opencode",
      password: "secret",
      authToken: true,
    })

    expect(url.protocol).toBe("wss:")
    expect(url.pathname).toBe("/api/pty/pty_test/connect")
    expect(url.searchParams.get("location[directory]")).toBe("/tmp/project")
    expect(url.searchParams.get("auth_token")).toBe(btoa("opencode:secret"))
  })
})
