import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

const port = Number(process.env.OPENCODE_PROXY_PORT ?? 8787)
const allowed = (process.env.OPENCODE_ALLOWED_SERVERS ?? "")
  .split(",")
  .map((value) => value.trim().replace(/\/$/, ""))
  .filter(Boolean)

const hopByHop = new Set(["connection", "content-encoding", "content-length", "etag", "host", "keep-alive", "transfer-encoding", "upgrade"])

function sendJson(res: ServerResponse, status: number, error: string) {
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify({ error }))
}

function validateTarget(value: string) {
  let target: URL
  try {
    target = new URL(value)
  } catch {
    throw new Error("Invalid target server URL")
  }
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) throw new Error("Invalid target server URL")
  if (allowed.length === 0 || !allowed.includes(target.origin.replace(/\/$/, ""))) throw new Error("OpenCode server is not allowlisted")
  return target
}

async function proxy(req: IncomingMessage, res: ServerResponse) {
  try {
    const incoming = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
    const targetValue = incoming.searchParams.get("target")
    if (!targetValue) return sendJson(res, 400, "Missing target server parameter")
    const target = validateTarget(targetValue)
    const route = incoming.searchParams.get("__proxy_route") || incoming.pathname.replace(/^\/api\/opencode(?:\/api\/opencode)?/, "") || "/"
    incoming.searchParams.delete("target")
    incoming.searchParams.delete("__proxy_route")
    const upstream = new URL(route, `${target.origin}/`)
    incoming.searchParams.forEach((value, key) => upstream.searchParams.append(key, value))

    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined || hopByHop.has(key.toLowerCase()) || key.toLowerCase() === "accept-encoding") continue
      headers.set(key, Array.isArray(value) ? value.join(", ") : value)
    }
    const method = req.method ?? "GET"
    const body = method === "GET" || method === "HEAD" ? undefined : req
    const response = await fetch(upstream, { method, headers, body, duplex: body ? "half" : undefined } as RequestInit & { duplex?: "half" })
    res.statusCode = response.status
    response.headers.forEach((value, key) => {
      if (!hopByHop.has(key.toLowerCase())) res.setHeader(key, value)
    })
    if (!response.body) return res.end()
    const reader = response.body.getReader()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      res.write(Buffer.from(chunk.value))
    }
    res.end()
  } catch (error) {
    console.error("[opencode-proxy]", error)
    if (!res.headersSent) sendJson(res, 502, "Proxy upstream connection failed")
  }
}

createServer((req, res) => {
  if (req.url?.startsWith("/healthz")) return sendJson(res, 200, "ok")
  if (!req.url?.startsWith("/api/opencode")) return sendJson(res, 404, "Not found")
  void proxy(req, res)
}).listen(port, "127.0.0.1", () => {
  console.log(`[opencode-proxy] listening on 127.0.0.1:${port}`)
  console.log(`[opencode-proxy] allowed servers: ${allowed.join(", ") || "none"}`)
})
