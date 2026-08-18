import { describe, expect, mock, test } from "bun:test"
import { createLogger, type LogRecord } from "./observability/logger"
import { createUnifiedRuntimeMiddleware, type UnifiedRuntimeHandlers } from "./unified-runtime"

function request(url: string) {
  return { url, method: "GET", headers: { host: "localhost" } } as any
}

function response() {
  return {
    headersSent: false,
    statusCode: 200,
    setHeader: mock(() => undefined),
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

  test("correlates API requests and returns the request ID header", async () => {
    const records: LogRecord[] = []
    const logger = createLogger({ level: "trace", sink: (record) => records.push(record) })
    const handlers: UnifiedRuntimeHandlers = {
      control: async (_req, _res, pathname) => pathname === "/api/bootstrap",
      gateway: async () => true,
    }
    const res = response()
    await createUnifiedRuntimeMiddleware(handlers, { logger })(
      { ...request("/api/bootstrap"), headers: { host: "localhost", "x-request-id": "req_manual-123" } } as any,
      res,
      () => undefined,
    )

    expect(res.setHeader).toHaveBeenCalledWith("x-request-id", "req_manual-123")
    expect(records.map((record) => record.event)).toEqual(["request.start", "request.complete"])
    expect(records.every((record) => record.requestId === "req_manual-123")).toBe(true)
  })
})
