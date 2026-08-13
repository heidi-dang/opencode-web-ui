import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials, getEffectiveServerUrl } from "./server"

export type ServerProtocol = "v1" | "v2"
export type ServerProtocolState = ServerProtocol | "unknown"

function headers(server: ServerConnection.HttpBase) {
  if (!server.password) return
  return {
    Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
  }
}

async function probe(server: ServerConnection.HttpBase, fetch: typeof globalThis.fetch, path: string) {
  const effectiveUrl = getEffectiveServerUrl(server.url)
  const response = await fetch(new URL(path.replace(/^\/+/, ""), effectiveUrl.endsWith("/") ? effectiveUrl : effectiveUrl + "/"), {
    headers: headers(server),
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return
  const value: unknown = await response.json()
  if (!value || typeof value !== "object") return
  return value
}

export async function detectServerProtocol(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
): Promise<ServerProtocolState> {
  // Modern servers may still expose the legacy health endpoints for
  // compatibility. Probe the current project contract first; otherwise a
  // V1 classification makes the bootstrap call /api/project, which can be
  // served as the SPA HTML by a static frontend.
  const projects = await probe(server, fetch, "/project").catch(() => undefined)
  if (Array.isArray(projects)) return "v2"

  const legacy = await probe(server, fetch, "/global/health").catch(() => undefined)
  if (legacy && "healthy" in legacy && legacy.healthy === true) return "v1"

  const health = await probe(server, fetch, "/health").catch(() => undefined)
  if (health && "healthy" in health && health.healthy === true) return "v1"

  const current = await probe(server, fetch, "/api/health").catch(() => undefined)
  if (current && "pid" in current && typeof current.pid === "number") return "v2"
  if (current && "healthy" in current && current.healthy === true) return "v1"
  return "unknown"
}
