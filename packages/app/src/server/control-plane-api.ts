import type { IncomingMessage, ServerResponse } from "node:http"
import { getBootstrap } from "./services/bootstrap-service"
import { deleteBackend, getBackend, listBackendDescriptors, probeBackend, registerBackend, updateBackend } from "./services/backend-service"
import { runtimeLogger } from "./observability/logger"
import { handleClientDiagnosticsRequest } from "./client-diagnostics"
import { serializeControlPlaneHealth, serializeRegistration } from "./control-plane-contract"
import { controlErrorStatus } from "./http-error-status"

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

export async function handleControlPlaneRequest(req: IncomingMessage, res: ServerResponse, pathname: string) {
  runtimeLogger.debug("control.request", { method: req.method || "GET", route: pathname })
  try {
    if (pathname === "/api/debug/client-events") return handleClientDiagnosticsRequest(req, res)
    if (pathname === "/api/bootstrap" && req.method === "GET") return sendJson(res, 200, await getBootstrap())
    if (pathname === "/api/opencode/servers") {
      if (req.method === "GET") return sendJson(res, 200, { servers: await listBackendDescriptors() })
      if (req.method !== "POST") return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" })
      const input = await readJson(req)
      const server = await registerBackend({ name: typeof input.name === "string" ? input.name : undefined, baseUrl: typeof input.baseUrl === "string" ? input.baseUrl : "", username: typeof input.username === "string" ? input.username : undefined, password: typeof input.password === "string" ? input.password : undefined, enabled: input.enabled !== false })
      if (!server) return sendJson(res, 500, { error: "REGISTRATION_FAILED" })
      const result = await probeBackend(server.id)
      return sendJson(res, 201, serializeRegistration(result.server, result.health))
    }
    const match = pathname.match(/^\/api\/opencode\/servers\/([^/]+)(?:\/(health|reconnect))?$/)
    if (!match) return false
    const id = decodeURIComponent(match[1])
    const action = match[2] as "health" | "reconnect" | undefined
    if (action) {
      if (req.method !== "GET" && req.method !== "POST") return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" })
      const result = await probeBackend(id, action === "reconnect")
      return sendJson(res, action === "health" ? 200 : result.health.healthy ? 200 : 502, serializeControlPlaneHealth(result.server, result.health))
    }
    if (req.method === "GET") {
      const backend = await getBackend(id)
      return sendJson(res, backend ? 200 : 404, backend ? { server: backend.descriptor } : { error: "SERVER_NOT_FOUND" })
    }
    if (req.method === "PATCH") {
      const input = await readJson(req)
      const updated = await updateBackend(id, { name: typeof input.name === "string" ? input.name : undefined, baseUrl: typeof input.baseUrl === "string" ? input.baseUrl : undefined, username: typeof input.username === "string" ? input.username : undefined, password: typeof input.password === "string" ? input.password : undefined, enabled: typeof input.enabled === "boolean" ? input.enabled : undefined })
      return sendJson(res, updated ? 200 : 404, updated ? { server: "descriptor" in updated ? updated.descriptor : updated } : { error: "SERVER_NOT_FOUND" })
    }
    if (req.method === "DELETE") {
      const deleted = await deleteBackend(id)
      if (deleted) {
        res.statusCode = 204
        res.end()
        return
      }
      return sendJson(res, 404, { error: "SERVER_NOT_FOUND" })
    }
    return sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" })
  } catch (error) {
    const message = error instanceof Error ? error.message : "SERVER_OPERATION_FAILED"
    runtimeLogger.error("control.request.error", { method: req.method || "GET", route: pathname, errorCode: message, error })
    return sendJson(res, controlErrorStatus(message), { error: message })
  }
}
