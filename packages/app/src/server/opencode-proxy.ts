import type { IncomingMessage, ServerResponse } from "node:http"
import { getServer } from "./server-registry"
import { validateBackendDestination } from "./backend/network"
import { runtimeLogger } from "./observability/logger"
import { controlErrorStatus } from "./http-error-status"

const HOP_BY_HOP = new Set(["connection", "content-encoding", "content-length", "etag", "host", "keep-alive", "transfer-encoding", "upgrade"])

async function resolveServer(incoming: URL) {
  const serverId = incoming.searchParams.get("serverId")
  if (!serverId) throw new Error("SERVER_NOT_FOUND")
  const server = await getServer(serverId)
  if (!server) throw new Error("SERVER_NOT_FOUND")
  if (!server.enabled) throw new Error("SERVER_DISABLED")
  return { server, baseUrl: new URL(server.baseUrl) }
}


function json(res: ServerResponse, status: number, error: string) {
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify({ error }))
}

export async function proxyOpenCodeRequest(req: IncomingMessage & { method?: string; url?: string }, res: ServerResponse): Promise<boolean> {
  const upstreamAbort = new AbortController()
  const started = Date.now()
  const incoming = new URL(req.url || "/", `http://${req.headers?.host || "localhost"}`)
  const requestRoute = incoming.pathname.replace(/^\/api\/opencode(?:\/api\/opencode)?/, "") || "/"
  const method = req.method || "GET"
  const streaming = requestRoute.includes("event") || requestRoute.includes("stream")
  const sessionID = requestRoute.match(/\/session\/([^/]+)/)?.[1]
  const operation = requestRoute.includes("/prompt")
    ? "prompt"
    : requestRoute.includes("/interrupt")
      ? "interrupt"
      : requestRoute.includes("/project")
        ? "projects"
        : requestRoute.includes("/session")
          ? "sessions"
          : requestRoute.includes("/provider")
            ? "providers"
            : requestRoute.includes("/model")
              ? "models"
              : "gateway"
  const logFields = { method, route: requestRoute, operation, sessionId: sessionID, streaming }
  const onRequestAbort = () => {
    runtimeLogger.warn("gateway.client_disconnect", { ...logFields, reason: "request_aborted" })
    upstreamAbort.abort()
  }
  const onResponseClose = () => {
    if (!upstreamFinished) runtimeLogger.warn("gateway.client_disconnect", { ...logFields, reason: "response_closed" })
    upstreamAbort.abort()
  }
  const onResponseError = () => {
    runtimeLogger.warn("gateway.client_disconnect", { ...logFields, reason: "response_error" })
    upstreamAbort.abort()
  }
  let upstreamFinished = false
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

  const removeListeners = () => {
    req.removeListener?.("aborted", onRequestAbort)
    res.removeListener?.("close", onResponseClose)
    res.removeListener?.("error", onResponseError)
  }

  const waitForDrain = () => {
    if (upstreamAbort.signal.aborted) return Promise.reject(new Error("CLIENT_DISCONNECTED"))
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        res.removeListener?.("drain", onDrain)
        reject(new Error("CLIENT_DISCONNECTED"))
      }
      const onDrain = () => {
        upstreamAbort.signal.removeEventListener("abort", onAbort)
        resolve()
      }
      res.once?.("drain", onDrain)
      upstreamAbort.signal.addEventListener("abort", onAbort, { once: true })
    })
  }

  req.once?.("aborted", onRequestAbort)
  res.once?.("close", onResponseClose)
  res.once?.("error", onResponseError)
  try {
    const route = incoming.searchParams.get("__proxy_route") || requestRoute
    runtimeLogger.debug("gateway.start", { ...logFields, route })
    let origin: URL
    let registered: Awaited<ReturnType<typeof resolveServer>>["server"]
    try {
      const resolved = await resolveServer(incoming)
      origin = await validateBackendDestination(resolved.baseUrl.toString())
      registered = resolved.server
      runtimeLogger.debug("gateway.upstream_resolved", { ...logFields, backendId: registered.id, protocol: registered.protocol, upstreamRoute: route })
    } catch (error) {
      const message = error instanceof Error ? error.message : "SERVER_NOT_FOUND"
      const status = controlErrorStatus(message)
      runtimeLogger.warn("gateway.redirect_rejected", { ...logFields, status, errorCode: message, error })
      return json(res, status, message) as never
    }
    incoming.searchParams.delete("serverId")
    incoming.searchParams.delete("__proxy_route")
    const basePath = origin.pathname.replace(/\/$/, "")
    // The legacy SDK asks for /api/project, while current OpenCode exposes
    // the same catalogue at /project. Keep that compatibility at the gateway
    // so a v2 server is never mistaken for an empty project list.
    const upstreamRoute = registered.protocol === "v2" && route === "/api/project" ? "/project" : route
    const upstream = new URL(`${basePath}${upstreamRoute}`, `${origin.origin}/`)
    incoming.searchParams.forEach((value, key) => upstream.searchParams.append(key, value))
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers || {})) {
      const lower = key.toLowerCase()
      if (!HOP_BY_HOP.has(lower) && lower !== "accept-encoding" && lower !== "authorization" && value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value)
    }
    if (registered.password) headers.set("authorization", `Basic ${Buffer.from(`${registered.username || "opencode"}:${registered.password}`).toString("base64")}`)
    const body = method === "GET" || method === "HEAD" ? undefined : req
    runtimeLogger.debug("gateway.upstream_start", { ...logFields, backendId: registered.id, protocol: registered.protocol, upstreamRoute: upstream.pathname })
    const response = await fetch(upstream, {
      method,
      headers,
      body,
      signal: upstreamAbort.signal,
      duplex: body ? "half" : undefined,
      redirect: "manual",
    } as unknown as RequestInit & { duplex?: "half" })
    if (response.status >= 300 && response.status < 400) {
      throw new Error("UPSTREAM_REDIRECT_NOT_ALLOWED")
    }
    res.statusCode = response.status
    runtimeLogger.debug("gateway.response", { ...logFields, backendId: registered.id, protocol: registered.protocol, status: response.status, responseType: response.headers.get("content-type") || undefined })
    if (operation === "prompt" && response.status >= 200 && response.status < 300) {
      runtimeLogger.info("prompt.admission", { ...logFields, backendId: registered.id, protocol: registered.protocol, status: response.status })
    }
    if (operation === "interrupt" && response.status >= 200 && response.status < 300) {
      runtimeLogger.info("interrupt.acknowledged", { ...logFields, backendId: registered.id, protocol: registered.protocol, status: response.status })
    }
    response.headers.forEach((value, key) => { if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== "www-authenticate") res.setHeader(key, value) })
    if (!response.body) {
      upstreamFinished = true
      res.end()
      return true
    }
    reader = response.body.getReader()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (!res.write(Buffer.from(chunk.value))) await waitForDrain()
    }
    upstreamFinished = true
    res.end()
    runtimeLogger.debug("gateway.complete", { ...logFields, backendId: registered.id, status: response.status, durationMs: Date.now() - started })
    return true
  } catch (error) {
    if (upstreamAbort.signal.aborted) runtimeLogger.info("gateway.abort", { ...logFields, durationMs: Date.now() - started })
    else runtimeLogger.error("gateway.upstream_error", { ...logFields, durationMs: Date.now() - started, error })
    if (!res.headersSent) json(res, 502, "UPSTREAM_CONNECTION_FAILED")
    return true
  } finally {
    removeListeners()
    if (!upstreamFinished) upstreamAbort.abort()
    await reader?.cancel().catch(() => undefined)
  }
}
