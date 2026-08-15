import type { IncomingMessage, ServerResponse } from "node:http"

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify(body))
  }
  try {
    const incoming = new URL(req.url || "/", `http://${req.headers?.host || "localhost"}`)
    const target = incoming.searchParams.get("target") || "http://139.180.175.60:4096"
    const route = incoming.searchParams.get("route") || "/global/health"
    const upstream = new URL(route, target)
    incoming.searchParams.forEach((value, key) => {
      if (!new Set(["target", "route"]).has(key)) upstream.searchParams.append(key, value)
    })
    const phase = incoming.searchParams.get("phase") || "url"
    if (phase === "url") return send(200, { ok: true, phase, url: upstream.toString() })
    const response = await fetch(upstream, { headers: { "accept-encoding": "identity" } })
    if (phase === "fetch") return send(200, { ok: true, phase, upstreamStatus: response.status, bodyLength: (await response.text()).length })
    const body = await response.arrayBuffer()
    if (phase === "buffer") return send(200, { ok: true, phase, upstreamStatus: response.status, bodyLength: body.byteLength })
    const contentType = response.headers.get("content-type")
    if (contentType) res.setHeader("content-type", contentType)
    res.statusCode = response.status
    res.end(Buffer.from(body))
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    send(500, { ok: false, phase: "error", name: err.name, message: err.message, stack: err.stack })
  }
}
