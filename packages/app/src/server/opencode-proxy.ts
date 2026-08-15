import type { IncomingMessage, ServerResponse } from "node:http"

const HOP_BY_HOP = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "etag",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

function writeJson(res: ServerResponse, status: number, message: string) {
  if (res.headersSent) return
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify({ error: message }))
}

function forwardedHeaders(req: IncomingMessage) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    const lower = key.toLowerCase()
    if (HOP_BY_HOP.has(lower) || lower === "accept-encoding" || value === undefined) continue
    headers.set(key, Array.isArray(value) ? value.join(", ") : value)
  }
  return headers
}

export async function proxyOpenCodeRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  try {
    const incoming = new URL(req.url || "/", `http://${req.headers?.host || "localhost"}`)
    const route = incoming.searchParams.get("__proxy_route") ||
      incoming.pathname.replace(/^\/api\/opencode(?:\/api\/opencode)?/, "") || "/"
    const target = incoming.searchParams.get("target")
    if (!target) {
      writeJson(res, 400, "Missing target server parameter")
      return true
    }

    const origin = new URL(target)
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) {
      writeJson(res, 400, "Invalid target server URL")
      return true
    }

    incoming.searchParams.delete("target")
    incoming.searchParams.delete("__proxy_route")
    const upstream = new URL(route, `${origin.origin}/`)
    incoming.searchParams.forEach((value, key) => upstream.searchParams.append(key, value))

    const method = req.method || "GET"
    const body = method === "GET" || method === "HEAD" ? undefined : req
    const response = await fetch(upstream, {
      method,
      headers: forwardedHeaders(req),
      body,
      duplex: body ? "half" : undefined,
    } as RequestInit & { duplex?: "half" })

    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) res.setHeader(key, value)
    })
    const payload = Buffer.from(await response.arrayBuffer())
    res.end(payload)
    return true
  } catch (error) {
    console.error("[OpenCode Proxy Error]", error instanceof Error ? error.stack : error)
    try {
      writeJson(res, 502, "Proxy upstream connection failed")
    } catch {
      if (!res.headersSent) res.end()
    }
    return true
  }
}
