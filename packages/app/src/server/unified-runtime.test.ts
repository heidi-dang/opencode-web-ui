import { describe, expect, test } from "bun:test"
import { createUnifiedRuntimeMiddleware, type UnifiedRuntimeHandlers } from "./unified-runtime"

function request(url: string) {
  return { url, method: "GET", headers: { host: "localhost" } } as any
}

function response() {
  return {
    headersSent: false,
    statusCode: 200,
    setHeader() {},
    end() {},
  } as any
}

describe("unified Web UI runtime routing", () => {
  test("dispatches control-plane requests without a second server hop", async () => {
    const calls: string[] = []
    const handlers: UnifiedRuntimeHandlers = {
      control: async (_req, _res, pathname) => {
        calls.push(`control:${pathname}`)
        return true
      },
      gateway: async () => {
        calls.push("gateway")
        return true
      },
    }
    const middleware = createUnifiedRuntimeMiddleware(handlers)

    await middleware(request("/api/bootstrap"), response(), () => calls.push("next"))

    expect(calls).toEqual(["control:/api/bootstrap"])
  })

  test("dispatches compatibility requests through the same Web UI server", async () => {
    const calls: string[] = []
    const handlers: UnifiedRuntimeHandlers = {
      control: async () => {
        calls.push("control")
        return true
      },
      gateway: async () => {
        calls.push("gateway")
        return true
      },
    }
    const middleware = createUnifiedRuntimeMiddleware(handlers)

    await middleware(request("/api/opencode/session/ses_1/events"), response(), () => calls.push("next"))

    expect(calls).toEqual(["gateway"])
  })

  test("leaves application routes to Vite", async () => {
    const calls: string[] = []
    const handlers: UnifiedRuntimeHandlers = {
      control: async () => {
        calls.push("control")
        return true
      },
      gateway: async () => {
        calls.push("gateway")
        return true
      },
    }
    const middleware = createUnifiedRuntimeMiddleware(handlers)

    await middleware(request("/assets/index.js"), response(), () => calls.push("next"))

    expect(calls).toEqual(["next"])
  })
})
