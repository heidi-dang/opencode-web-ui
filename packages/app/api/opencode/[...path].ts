import { Readable } from "node:stream"
import type { IncomingMessage, ServerResponse } from "node:http"

const HOP_BY_HOP = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

type RequestWithUrl = IncomingMessage & { method?: string; url?: string }

export const config = { api: { bodyParser: false } }

export default async function handler(req: RequestWithUrl, res: ServerResponse) {
  try {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
    const target = requestUrl.searchParams.get("target")
    if (!target) {
      res.statusCode = 400
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ error: "Missing target server parameter" }))
      return
    }

    const targetUrl = new URL(target)
    if (!["http:", "https:"].includes(targetUrl.protocol) || targetUrl.username || targetUrl.password) {
      res.statusCode = 400
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ error: "Invalid target server URL" }))
      return
    }

    const path = requestUrl.pathname.replace(/^\/api\/opencode(?:\/api\/opencode)?/, "") || "/"
    const upstreamUrl = new URL(path, `${targetUrl.origin}/`)
    requestUrl.searchParams.forEach((value, key) => {
      if (key !== "target") upstreamUrl.searchParams.append(key, value)
    })

    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(key) || value === undefined) continue
      headers.set(key, Array.isArray(value) ? value.join(", ") : value)
    }

    const method = req.method || "GET"
    const body = method === "GET" || method === "HEAD" ? undefined : req
    const upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      duplex: body ? "half" : undefined,
    } as RequestInit & { duplex?: "half" })

    res.statusCode = upstream.status
    upstream.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key)) res.setHeader(key, value)
    })

    if (!upstream.body) {
      res.end()
      return
    }
    Readable.fromWeb(upstream.body as never).pipe(res)
  } catch (error) {
    console.error("[OpenCode Proxy Error]", error)
    if (!res.headersSent) {
      res.statusCode = 502
      res.setHeader("content-type", "application/json")
      res.end(JSON.stringify({ error: "Proxy upstream connection failed" }))
    } else {
      res.end()
    }
  }
}
