import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import {
  deleteServer,
  getServer,
  listServers,
  probeRegisteredServer,
  publicServer,
  registerServer,
  updateServer,
  updateServerHealth,
} from "../packages/app/src/server/server-registry"
import { proxyOpenCodeRequest } from "../packages/app/src/server/opencode-proxy"
import { getBootstrap } from "../packages/app/src/server/services/bootstrap-service"

const port = Number(process.env.OPENCODE_PROXY_PORT ?? 8787)

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify(payload))
}

async function readJson(req: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>
}

async function serverCollection(req: IncomingMessage, res: ServerResponse) {
  if (req.method === "GET") return sendJson(res, 200, { servers: (await listServers()).map(publicServer) })
  if (req.method !== "POST") return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" })

  const input = await readJson(req)
  const server = await registerServer({
    name: typeof input.name === "string" ? input.name : undefined,
    baseUrl: typeof input.baseUrl === "string" ? input.baseUrl : "",
    username: typeof input.username === "string" ? input.username : undefined,
    password: typeof input.password === "string" ? input.password : undefined,
    enabled: input.enabled !== false,
  })
  const probe = await probeRegisteredServer(server.id)
  const updated = (await updateServerHealth(server.id, { state: probe.state, protocol: probe.protocol, reachable: probe.reachable, authenticated: probe.authenticated, healthy: probe.healthy, latencyMs: probe.latencyMs, error: probe.error })) || server
  return sendJson(res, 201, {
    server: publicServer(updated),
    ready: probe.state === "READY",
    reachability: probe.reachable ? (probe.healthy ? "SERVER_READY" : "SERVER_HEALTH_FAILED") : "SERVER_REGISTERED_BUT_UNREACHABLE",
    probe,
  })
}

async function serverResource(req: IncomingMessage, res: ServerResponse, id: string, action?: "health" | "reconnect") {
  const server = await getServer(id)
  if (!server) return sendJson(res, 404, { error: "SERVER_NOT_FOUND" })
  if (action === "health" || action === "reconnect") {
    if (req.method !== "GET" && req.method !== "POST") return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" })
    const probe = await probeRegisteredServer(server.id)
    const updated = (await updateServerHealth(server.id, { state: probe.state, protocol: probe.protocol, reachable: probe.reachable, authenticated: probe.authenticated, healthy: probe.healthy, latencyMs: probe.latencyMs, error: probe.error })) || server
    return sendJson(res, action === "health" ? 200 : probe.state === "READY" ? 200 : 502, { server: publicServer(updated), ...probe })
  }
  if (req.method === "GET") return sendJson(res, 200, { server: publicServer(server) })
  if (req.method === "PATCH") {
    const input = await readJson(req)
    const updated = await updateServer(id, {
      name: typeof input.name === "string" ? input.name : undefined,
      baseUrl: typeof input.baseUrl === "string" ? input.baseUrl : undefined,
      username: typeof input.username === "string" ? input.username : undefined,
      password: typeof input.password === "string" ? input.password : undefined,
      enabled: typeof input.enabled === "boolean" ? input.enabled : undefined,
    })
    return sendJson(res, updated ? 200 : 404, updated ? { server: publicServer(updated) } : { error: "SERVER_NOT_FOUND" })
  }
  if (req.method === "DELETE") {
    if (await deleteServer(id)) {
      res.statusCode = 204
      return res.end()
    }
    return sendJson(res, 404, { error: "SERVER_NOT_FOUND" })
  }
  return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" })
}

export async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    const incoming = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
    if (incoming.pathname === "/healthz") return sendJson(res, 200, { error: "ok" })
    if (incoming.pathname === "/api/bootstrap" && req.method === "GET") {
      res.setHeader("cache-control", "private, max-age=0, stale-while-revalidate=5")
      return sendJson(res, 200, await getBootstrap())
    }
    if (incoming.pathname === "/api/opencode/servers") return serverCollection(req, res)

    const match = incoming.pathname.match(/^\/api\/opencode\/servers\/([^/]+)(?:\/(health|reconnect))?$/)
    if (match) return serverResource(req, res, decodeURIComponent(match[1]), match[2] as "health" | "reconnect" | undefined)
    if (incoming.pathname.startsWith("/api/opencode") || incoming.searchParams.has("__proxy_route")) {
      return proxyOpenCodeRequest(req, res)
    }
    return sendJson(res, 404, { error: "Not found" })
  } catch (error) {
    const message = error instanceof Error ? error.message : "REQUEST_FAILED"
    const status = ["UNSUPPORTED_URL_SCHEME", "UNSAFE_SERVER_URL", "INVALID_SERVER_URL", "DUPLICATE_SERVER_URL"].includes(message) ? 400 : 500
    return sendJson(res, status, { error: message })
  }
}

if (import.meta.main) {
  createServer((req, res) => void handleRequest(req, res)).listen(port, "127.0.0.1", () => {
    console.log(`[opencode-proxy] listening on 127.0.0.1:${port}`)
  })
}
