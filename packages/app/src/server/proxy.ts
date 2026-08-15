import type { IncomingMessage, ServerResponse } from "node:http"
import { proxyOpenCodeRequest } from "./opencode-proxy"

export async function handleOpenCodeProxy(
  req: IncomingMessage,
  res: ServerResponse,
  next?: () => void,
): Promise<boolean | void> {
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
  if (!reqUrl.pathname.startsWith("/api/opencode") && !reqUrl.searchParams.has("__proxy_route")) {
    return next ? next() : false
  }
  return proxyOpenCodeRequest(req, res)
}
