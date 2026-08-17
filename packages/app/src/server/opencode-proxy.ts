import type { IncomingMessage, ServerResponse } from "node:http"
import { getServer } from "@/server/server-registry"

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
  try {
    const incoming = new URL(req.url || "/", `http://${req.headers?.host || "localhost"}`)
    const route = incoming.searchParams.get("__proxy_route") || incoming.pathname.replace(/^\/api\/opencode(?:\/api\/opencode)?/, "") || "/"
    let origin: URL
    let registered: Awaited<ReturnType<typeof resolveServer>>["server"]
    try {
      const resolved = await resolveServer(incoming)
      origin = resolved.baseUrl
      registered = resolved.server
    } catch (error) {
      const message = error instanceof Error ? error.message : "SERVER_NOT_FOUND"
      const status = message === "SERVER_NOT_FOUND" ? 404 : message === "SERVER_DISABLED" ? 409 : 500
      return json(res, status, message) as never
    }
    incoming.searchParams.delete("serverId")
    incoming.searchParams.delete("__proxy_route")
    const basePath = origin.pathname.replace(/\/$/, "")
    const upstream = new URL(`${basePath}${route}`, `${origin.origin}/`)
    incoming.searchParams.forEach((value, key) => upstream.searchParams.append(key, value))
    const method = req.method || "GET"
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers || {})) {
      const lower = key.toLowerCase()
      if (!HOP_BY_HOP.has(lower) && lower !== "accept-encoding" && (!registered.password || lower !== "authorization") && value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value)
    }
    if (registered.password) headers.set("authorization", `Basic ${Buffer.from(`${registered.username || "opencode"}:${registered.password}`).toString("base64")}`)
    const body = method === "GET" || method === "HEAD" ? undefined : req
    const response = await fetch(upstream, { method, headers, body, duplex: body ? "half" : undefined } as RequestInit & { duplex?: "half" })
    res.statusCode = response.status
    response.headers.forEach((value, key) => { if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== "www-authenticate") res.setHeader(key, value) })
    if (!response.body) {
      res.end()
      return true
    }
    const reader = response.body.getReader()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      res.write(Buffer.from(chunk.value))
    }
    res.end()
    return true
  } catch (error) {
    console.error("[OpenCode Proxy Error]", error instanceof Error ? error.name : "unknown")
    if (!res.headersSent) json(res, 502, "UPSTREAM_CONNECTION_FAILED")
    return true
  }
}
