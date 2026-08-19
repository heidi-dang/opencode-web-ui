import type { IncomingMessage, ServerResponse } from "node:http"
import { normalizeRequestId, runtimeLogger, type LogFields } from "./observability/logger"
import { runWithRequestContext } from "./observability/request-context"

type Request = IncomingMessage & { method?: string; url?: string }
type Next = () => void

export type UnifiedRuntimeHandlers = {
  control(req: Request, res: ServerResponse, pathname: string): Promise<boolean | void>
  gateway(req: Request, res: ServerResponse, next: Next): Promise<boolean | void>
}

type RuntimeLogger = Pick<ReturnType<typeof import("./observability/logger").createLogger>, "debug" | "info" | "warn" | "error">

type RuntimeOptions = { logger?: RuntimeLogger }

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function requestId(req: Request) {
  const provided = normalizeRequestId(headerValue(req.headers?.["x-request-id"]))
  return provided || `req_${crypto.randomUUID()}`
}

function requestFields(req: Request, url: URL): LogFields {
  return {
    method: req.method || "GET",
    route: url.pathname,
    backendId: url.searchParams.get("serverId") || undefined,
  }
}

export function createUnifiedRuntimeMiddleware(handlers: UnifiedRuntimeHandlers, options: RuntimeOptions = {}) {
  const logger = options.logger || runtimeLogger
  return async (req: Request, res: ServerResponse, next: Next): Promise<void> => {
    const incoming = new URL(req.url || "/", "http://localhost")
    const pathname = incoming.pathname
    const isControl = pathname === "/api/bootstrap" || pathname === "/api/debug/client-events" || pathname === "/api/opencode/servers" || pathname.startsWith("/api/opencode/servers/")
    const isApi = pathname.startsWith("/api/")
    if (!isApi) return next()

    const id = requestId(req)
    const fields = requestFields(req, incoming)
    let completed = false
    const onAbort = () => logger.warn("request.abort", { ...fields, requestId: id, clientDisconnected: true })
    req.once?.("aborted", onAbort)

    return runWithRequestContext({ requestId: id, backendId: fields.backendId as string | undefined }, async () => {
      if (!res.headersSent) res.setHeader("x-request-id", id)
      logger.debug("request.start", { ...fields, requestId: id })
      try {
        if (isControl) {
          const handled = await handlers.control(req, res, pathname)
          if (handled !== false) return
        }
        if (pathname.startsWith("/api/opencode/")) {
          await handlers.gateway(req, res, next)
          return
        }
        return next()
      } catch (error) {
        logger.error("request.error", { ...fields, requestId: id, error })
        if (res.headersSent) return
        res.statusCode = 500
        res.setHeader("content-type", "application/json; charset=utf-8")
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : "WEB_RUNTIME_REQUEST_FAILED", requestId: id }))
      } finally {
        if (!completed) {
          completed = true
          logger.debug("request.complete", { ...fields, requestId: id, status: res.statusCode })
          req.removeListener?.("aborted", onAbort)
        }
      }
    })
  }
}
