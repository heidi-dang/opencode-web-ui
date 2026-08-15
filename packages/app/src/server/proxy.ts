import type { IncomingMessage, ServerResponse } from "node:http"

const HOP_BY_HOP_HEADERS = new Set([
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

function writeJson(res: ServerResponse, status: number, body: { error: string }) {
  if (res.headersSent) return
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  res.end(JSON.stringify(body))
}

function forwardedHeaders(req: IncomingMessage) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase()) || value === undefined) continue
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item))
    else headers.set(key, value)
  }
  return headers
}

export async function handleOpenCodeProxy(
  req: IncomingMessage,
  res: ServerResponse,
  next?: () => void,
): Promise<boolean | void> {
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`)
  if (!reqUrl.pathname.startsWith("/api/opencode")) return next ? next() : false

  const target = reqUrl.searchParams.get("target")
  if (!target) {
    writeJson(res, 400, { error: "Missing target server parameter" })
    return true
  }

  let targetOrigin: URL
  try {
    targetOrigin = new URL(target)
    if (!['http:', 'https:'].includes(targetOrigin.protocol) || targetOrigin.username || targetOrigin.password) {
      throw new Error("Invalid target server URL")
    }
  } catch {
    writeJson(res, 400, { error: "Invalid target server URL" })
    return true
  }

  const subPath = reqUrl.pathname.replace(/^\/api\/opencode(?:\/api\/opencode)?/, "") || "/"
  const upstreamUrl = new URL(subPath, targetOrigin.origin.endsWith("/") ? targetOrigin.origin : `${targetOrigin.origin}/`)
  reqUrl.searchParams.forEach((value, key) => {
    if (key !== "target") upstreamUrl.searchParams.append(key, value)
  })

  try {
    const method = req.method || "GET"
    const body = method === "GET" || method === "HEAD" ? undefined : req
    const upstreamResponse = await fetch(upstreamUrl, {
      method,
      headers: forwardedHeaders(req),
      body,
      duplex: body ? "half" : undefined,
    } as RequestInit & { duplex?: "half" })

    const responseHeaders: Record<string, string> = {}
    upstreamResponse.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) responseHeaders[key] = value
    })
    res.writeHead(upstreamResponse.status, responseHeaders)

    if (!upstreamResponse.body) {
      res.end()
      return true
    }

    const reader = upstreamResponse.body.getReader()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        res.write(chunk.value)
      }
    } finally {
      reader.releaseLock()
      res.end()
    }
    return true
  } catch (error) {
    console.error("[OpenCode Proxy Error]", error instanceof Error ? error.message : "upstream request failed")
    if (!res.headersSent)
      writeJson(res, 502, {
        error: "Proxy upstream connection failed",
      })
    else res.end()
    return true
  }
}
