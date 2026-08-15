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
    const incoming = new URL(req.url || "/", "http://localhost")
    const target = incoming.searchParams.get("target")
    const path = incoming.searchParams.get("path") || "/"
    if (!target) return sendJson(res, 400, { error: "Missing target server parameter" })

    const origin = new URL(target)
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) {
      return sendJson(res, 400, { error: "Invalid target server URL" })
    }

    incoming.searchParams.delete("target")
    incoming.searchParams.delete("path")
    const upstream = new URL(path, `${origin.origin}/`)
    incoming.searchParams.forEach((value, key) => upstream.searchParams.append(key, value))

    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(key) || value === undefined) continue
      headers.set(key, Array.isArray(value) ? value.join(", ") : value)
    }

    const method = req.method || "GET"
    const response = await fetch(upstream, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : req,
      duplex: method === "GET" || method === "HEAD" ? undefined : "half",
    } as RequestInit & { duplex?: "half" })

    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key)) res.setHeader(key, value)
    })
    if (!response.body) return res.end()

    const reader = response.body.getReader()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      res.write(chunk.value)
    }
    res.end()
  } catch (error) {
    console.error("[OpenCode Proxy Error]", error)
    try {
      sendJson(res, 502, { error: "Proxy upstream connection failed" })
    } catch {
      res.end()
    }
  }
}

function sendJson(res: ServerResponse, status: number, body: { error: string }) {
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify(body))
}
