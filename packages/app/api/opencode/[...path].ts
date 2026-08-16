import type { IncomingMessage, ServerResponse } from "node:http"

type RequestWithUrl = IncomingMessage & { method?: string; url?: string }
const HOP_BY_HOP = new Set(["connection", "content-encoding", "content-length", "etag", "host", "keep-alive", "transfer-encoding", "upgrade"])

function json(res: ServerResponse, status: number, error: string) {
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify({ error }))
}

export const config = { api: { bodyParser: false } }

export default async function handler(req: RequestWithUrl, res: ServerResponse) {
  try {
    const incoming = new URL(req.url || "/", `http://${req.headers?.host || "localhost"}`)
    const route = incoming.searchParams.get("__proxy_route") || incoming.pathname.replace(/^\/api\/opencode(?:\/api\/opencode)?/, "") || "/"
    const target = incoming.searchParams.get("target")
    if (!target) return json(res, 400, "Missing target server parameter")
    const origin = new URL(target)
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) return json(res, 400, "Invalid target server URL")
    incoming.searchParams.delete("target")
    incoming.searchParams.delete("__proxy_route")
    const upstream = new URL(route, `${origin.origin}/`)
    incoming.searchParams.forEach((value, key) => upstream.searchParams.append(key, value))
    const method = req.method || "GET"
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers || {})) {
      const lower = key.toLowerCase()
      if (!HOP_BY_HOP.has(lower) && lower !== "accept-encoding" && value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value)
    }
    const body = method === "GET" || method === "HEAD" ? undefined : req
    const response = await fetch(upstream, { method, headers, body, duplex: body ? "half" : undefined } as RequestInit & { duplex?: "half" })
    res.statusCode = response.status
    response.headers.forEach((value, key) => { if (!HOP_BY_HOP.has(key.toLowerCase())) res.setHeader(key, value) })
    if (!response.body) {
      res.end()
      return
    }
    const reader = response.body.getReader()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      res.write(Buffer.from(chunk.value))
    }
    res.end()
  } catch (error) {
    console.error("[OpenCode Proxy Error]", error instanceof Error ? error.stack : error)
    if (!res.headersSent) json(res, 502, "Proxy upstream connection failed")
  }
}
