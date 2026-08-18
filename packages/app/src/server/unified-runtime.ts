import type { IncomingMessage, ServerResponse } from "node:http"

type Request = IncomingMessage & { method?: string; url?: string }
type Next = () => void

export type UnifiedRuntimeHandlers = {
  control(req: Request, res: ServerResponse, pathname: string): Promise<boolean | void>
  gateway(req: Request, res: ServerResponse, next: Next): Promise<boolean | void>
}

export function createUnifiedRuntimeMiddleware(handlers: UnifiedRuntimeHandlers) {
  return async (req: Request, res: ServerResponse, next: Next): Promise<void> => {
    const pathname = req.url ? new URL(req.url, "http://localhost").pathname : ""
    const isControl = pathname === "/api/bootstrap" || pathname === "/api/opencode/servers" || pathname.startsWith("/api/opencode/servers/")
    if (!isControl && !pathname.startsWith("/api/opencode/")) return next()

    try {
      if (isControl) {
        const handled = await handlers.control(req, res, pathname)
        if (handled !== false) return
      }
      await handlers.gateway(req, res, next)
    } catch (error) {
      if (res.headersSent) return
      res.statusCode = 500
      res.setHeader("content-type", "application/json; charset=utf-8")
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : "WEB_RUNTIME_REQUEST_FAILED" }))
    }
  }
}
