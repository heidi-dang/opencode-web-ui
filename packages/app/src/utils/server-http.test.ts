import { describe, expect, test } from "bun:test"
import { buildServerHttpBase, DEFAULT_USERNAME } from "./server-http"

describe("buildServerHttpBase", () => {
  test("URL only produces a bare HttpBase with no username or password", () => {
    const http = buildServerHttpBase({ url: "http://100.64.0.10:4096" })

    expect(http).toEqual({ url: "http://100.64.0.10:4096" })
    expect(Object.hasOwn(http, "username")).toBe(false)
    expect(Object.hasOwn(http, "password")).toBe(false)
  })

  test("password with blank username uses the supported default username", () => {
    const http = buildServerHttpBase({
      url: "http://100.64.0.10:4096",
      username: "  ",
      password: "secret",
    })

    expect(http).toEqual({ url: "http://100.64.0.10:4096", username: DEFAULT_USERNAME, password: "secret" })
    expect(http.username).toBe("opencode")
  })

  test("password with explicit username preserves the trimmed username", () => {
    const http = buildServerHttpBase({
      url: "http://100.64.0.10:4096",
      username: "  admin  ",
      password: "secret",
    })

    expect(http).toEqual({ url: "http://100.64.0.10:4096", username: "admin", password: "secret" })
  })

  test("username without password produces a bare HttpBase that does not store the username", () => {
    const http = buildServerHttpBase({
      url: "http://100.64.0.10:4096",
      username: "opencode",
      password: undefined,
    })

    expect(http).toEqual({ url: "http://100.64.0.10:4096" })
    expect(Object.hasOwn(http, "username")).toBe(false)
  })

  test("username-only input never creates a credentialed connection", () => {
    const http = buildServerHttpBase({
      url: "http://100.64.0.10:4096",
      username: "opencode",
      password: "",
    })

    expect(Object.hasOwn(http, "password")).toBe(false)
    expect(Object.hasOwn(http, "username")).toBe(false)
    expect(http).toEqual({ url: "http://100.64.0.10:4096" })
  })
})
