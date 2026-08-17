import type { IncomingMessage, ServerResponse } from "node:http"

const HOP_BY_HOP = new Set(["connection", "content-encoding", "content-length", "etag", "host", "keep-alive", "transfer-encoding", "upgrade"])

function json(res: ServerResponse, status: number, error: string) {
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify({ error }))
}

type RegisteredServer = { id: string; baseUrl: URL; enabled: boolean }

function validateBaseUrl(value: string) {
  const parsed = new URL(value)
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Invalid registered server URL")
  }
  parsed.hash = ""
  parsed.search = ""
  parsed.pathname = parsed.pathname.replace(/\/$/, "") || "/"
  return parsed
}

function serverRegistry(): Map<string, RegisteredServer> {
  const raw = process.env.OPENCODE_SERVERS_CONFIG
  if (!raw) {
    const configured = (process.env.OPENCODE_ALLOWED_SERVERS ?? "").split(",").map((item) => item.trim()).filter(Boolean)
    return new Map(configured.map((value) => {
      const baseUrl = validateBaseUrl(value)
      const id = baseUrl.toString().replace(/\/$/, "")
      return [id, { id, baseUrl, enabled: true }]
    }))
  }
  let values: unknown
  try {
    values = JSON.parse(raw)
  } catch {
    throw new Error("Invalid server registry configuration")
  }
  if (!Array.isArray(values)) throw new Error("Invalid server registry configuration")
  const registry = new Map<string, RegisteredServer>()
  for (const item of values) {
    if (!item || typeof item !== "object") throw new Error("Invalid server registry configuration")
    const record = item as Record<string, unknown>
    if (typeof record.id !== "string" || typeof record.baseUrl !== "string") throw new Error("Invalid server registry configuration")
    registry.set(record.id, { id: record.id, baseUrl: validateBaseUrl(record.baseUrl), enabled: record.enabled !== false })
  }
  return registry
}

function resolveServer(incoming: URL) {
  const registry = serverRegistry()
  const serverId = incoming.searchParams.get("serverId")
  if (serverId) {
    const server = registry.get(serverId)
    if (!server) throw new Error("SERVER_NOT_FOUND")
    if (!server.enabled) throw new Error("SERVER_DISABLED")
    return server.baseUrl
  }
  throw new Error("SERVER_NOT_FOUND")
}

export async function proxyOpenCodeRequest(req: IncomingMessage & { method?: string; url?: string }, res: ServerResponse): Promise<boolean> {
  try {
    const incoming = new URL(req.url || "/", `http://${req.headers?.host || "localhost"}`)
    const route = incoming.searchParams.get("__proxy_route") || incoming.pathname.replace(/^\/api\/opencode(?:\/api\/opencode)?/, "") || "/"
    let origin: URL
    try {
      origin = resolveServer(incoming)
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
      if (!HOP_BY_HOP.has(lower) && lower !== "accept-encoding" && value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value)
    }
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
