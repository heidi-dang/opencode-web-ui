import type { IncomingMessage, ServerResponse } from "node:http"

export const config = { api: { bodyParser: false } }

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const incoming = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
    const target = incoming.searchParams.get("target")
    if (!target) { res.statusCode = 400; res.end(JSON.stringify({ error: "Missing target server parameter" })); return }
    const origin = new URL(target)
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) { res.statusCode = 400; res.end(JSON.stringify({ error: "Invalid target server URL" })); return }
    incoming.searchParams.delete("target")
    const upstream = new URL("/file", origin.origin)
    incoming.searchParams.forEach((value, key) => upstream.searchParams.set(key, value))
    const response = await fetch(upstream)
    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      if (!["connection", "content-encoding", "content-length", "host", "transfer-encoding"].includes(key.toLowerCase())) res.setHeader(key, value)
    })
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    console.error("[OpenCode File Proxy Error]", error instanceof Error ? error.stack : error)
    if (!res.headersSent) { res.statusCode = 502; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ error: "Proxy upstream connection failed" })) }
  }
}
