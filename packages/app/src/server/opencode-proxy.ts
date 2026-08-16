import type { IncomingMessage, ServerResponse } from "node:http"

const HOP_BY_HOP = new Set(["connection", "content-encoding", "content-length", "etag", "host", "keep-alive", "transfer-encoding", "upgrade"])

function json(res: ServerResponse, status: number, error: string) {
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify({ error }))
}

function validateTarget(value: string) {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error("Invalid target server URL")
  }

  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Invalid target server URL")
  }

  const configured = (process.env.OPENCODE_ALLOWED_SERVERS ?? "")
    .split(",")
    .map((item) => item.trim().replace(/\/$/, ""))
    .filter(Boolean)

  if (configured.length === 0 || !configured.includes(parsed.origin.replace(/\/$/, ""))) {
    throw new Error("OpenCode server is not allowlisted")
  }

  return parsed
}

export async function proxyOpenCodeRequest(req: IncomingMessage & { method?: string; url?: string }, res: ServerResponse): Promise<boolean> {
  try {
    const incoming = new URL(req.url || "/", `http://${req.headers?.host || "localhost"}`)
    const route = incoming.searchParams.get("__proxy_route") || incoming.pathname.replace(/^\/api\/opencode(?:\/api\/opencode)?/, "") || "/"
    const target = incoming.searchParams.get("target")
    if (!target) return json(res, 400, "Missing target server parameter") as never
    let origin: URL
    try {
      origin = validateTarget(target)
    } catch (error) {
      return json(res, 403, error instanceof Error ? error.message : "OpenCode server is not allowlisted") as never
    }
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
    res.end(Buffer.from(await response.arrayBuffer()))
    return true
  } catch (error) {
    console.error("[OpenCode Proxy Error]", error instanceof Error ? error.stack : error)
    if (!res.headersSent) json(res, 502, "Proxy upstream connection failed")
    return true
  }
}
