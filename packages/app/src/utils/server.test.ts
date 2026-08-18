import { describe, expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, fetchForServer, getProxyEndpoint } from "./server"

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
      expect(getProxyEndpoint("https://tail.example/opencode", "/global/health", undefined, "srv_test")).toBe("/api/opencode/opencode/global/health?serverId=srv_test")
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

describe("fetchForServer browser transport", () => {
  test("buffers a generated Request body before sending it to the gateway", async () => {
    const previous = window.location.href
    const happyWindow = window as typeof window & { happyDOM: { setURL: (url: string) => void } }
    happyWindow.happyDOM.setURL("https://ai.example/")

    try {
      const source = JSON.stringify({ prompt: { text: "Hi" } })
      const sdkRequest = new Request("https://tail.example/api/session/ses_1/prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: source,
      })
      let forwarded: Request | undefined
      const fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body instanceof ReadableStream || (input instanceof Request && input.body instanceof ReadableStream)) {
          throw new Error("ReadableStream uploading is not supported")
        }
        forwarded = new Request(input, init)
        return new Response("ok")
      }, { preconnect: globalThis.fetch.preconnect })

      await fetchForServer(
        { url: "https://tail.example", id: "srv_test" } as never,
        fetch,
      )(sdkRequest)

      expect(forwarded).toBeDefined()
      expect(new URL(forwarded!.url).pathname).toBe("/api/opencode/api/session/ses_1/prompt")
      expect(new URL(forwarded!.url).searchParams.get("serverId")).toBe("srv_test")
      expect(forwarded!.method).toBe("POST")
      expect(forwarded!.headers.get("content-type")).toBe("application/json")
      expect(await forwarded!.text()).toBe(source)
    } finally {
      happyWindow.happyDOM.setURL(previous)
    }
  })

  test("supports normal body inputs and keeps GET/HEAD bodyless", async () => {
    const previous = window.location.href
    const happyWindow = window as typeof window & { happyDOM: { setURL: (url: string) => void } }
    happyWindow.happyDOM.setURL("https://ai.example/")

    try {
      const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
      const fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.body instanceof ReadableStream) throw new Error("ReadableStream uploading is not supported")
        calls.push({ input, init })
        return new Response("ok")
      }, { preconnect: globalThis.fetch.preconnect })
      const transport = fetchForServer({ url: "https://tail.example", id: "srv_test" } as never, fetch)

      await transport("https://tail.example/api/session/ses_1/rename", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Renamed" }),
      })
      await transport("https://tail.example/api/session/ses_1/archive", {
        method: "DELETE",
        body: new URLSearchParams({ reason: "done" }),
      })
      await transport("https://tail.example/api/session/ses_1", { method: "GET" })
      await transport("https://tail.example/api/session/ses_1", { method: "HEAD" })

      expect(calls).toHaveLength(4)
      expect(calls.map((call) => call.init?.method)).toEqual(["PATCH", "DELETE", "GET", "HEAD"])
      expect(calls[0]!.init?.body).toBe(JSON.stringify({ title: "Renamed" }))
      expect(calls[1]!.init?.body).toBeInstanceOf(URLSearchParams)
      expect(calls[2]!.init?.body).toBeUndefined()
      expect(calls[3]!.init?.body).toBeUndefined()
      for (const call of calls) {
        expect(new URL(String(call.input)).searchParams.get("serverId")).toBe("srv_test")
      }
    } finally {
      happyWindow.happyDOM.setURL(previous)
    }
  })
})
