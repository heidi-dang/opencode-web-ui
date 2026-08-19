import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials, fetchForServer } from "./server"

export type ServerProtocol = "v1" | "v2"
export type DetectedServerProtocol = ServerProtocol | "unknown"

export class ServerProtocolError extends Error {
  readonly cause: unknown
  readonly code: string
  readonly status?: number

  constructor(message: string, cause?: unknown, options?: { code?: string; status?: number }) {
    super(message)
    this.name = "ServerProtocolError"
    this.cause = cause
    this.code = options?.code ?? "PROTOCOL_UNKNOWN"
    this.status = options?.status
  }
}

function headers(server: ServerConnection.HttpBase) {
  if (!server.password) return
  return {
    Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
  }
}

async function probe(server: ServerConnection.HttpBase, fetch: typeof globalThis.fetch, path: string) {
  const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(5_000) : undefined
  const request = fetchForServer(server, fetch)
  const base = server.url.endsWith("/") ? server.url : `${server.url}/`
  const response = await request(new URL(path.replace(/^\//, ""), base), {
    headers: headers(server),
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403 ? "AUTH_FAILED" : response.status === 404 ? "SERVER_NOT_FOUND" : "OPENCODE_HEALTH_FAILED"
    throw new ServerProtocolError(`Protocol probe returned ${response.status}`, undefined, { code, status: response.status })
  }
  let value: unknown
  try {
    value = await response.json()
  } catch (error) {
    throw new ServerProtocolError("Protocol probe returned malformed JSON", error, { code: "MALFORMED_HEALTH_RESPONSE" })
  }
  if (!value || typeof value !== "object") throw new Error("Protocol probe returned malformed JSON")
  return value
}

async function probeRegisteredGateway(server: ServerConnection.HttpBase, fetch: typeof globalThis.fetch) {
  const response = await fetch(`/api/opencode/servers/${encodeURIComponent(server.id!)}/health`)
  let value: unknown
  try {
    value = await response.json()
  } catch (error) {
    throw new ServerProtocolError("Gateway returned malformed probe data", error, { code: "MALFORMED_HEALTH_RESPONSE", status: response.status })
  }
  const payload = value && typeof value === "object" ? value as {
    error?: unknown
    state?: unknown
    protocol?: unknown
    server?: { state?: unknown; protocol?: unknown; error?: unknown }
    health?: { state?: unknown; protocol?: unknown; error?: unknown }
  } : undefined
  // The control-plane health route returns `{ server, health }`, while older
  // gateway deployments returned the health fields at the top level. Accept
  // both shapes so a healthy registered backend is not rejected by the browser
  // protocol detector.
  const reportedError = [payload?.error, payload?.server?.error, payload?.health?.error].find((item): item is string => typeof item === "string" && item.trim().length > 0)
  const reportedState = payload?.state ?? payload?.server?.state ?? payload?.health?.state
  if (!response.ok || reportedError || reportedState !== "READY") {
    const code = reportedError || (response.status === 401 || response.status === 403 ? "AUTH_FAILED" : "OPENCODE_HEALTH_FAILED")
    throw new ServerProtocolError(`Gateway probe failed: ${code}`, value, { code, status: response.status })
  }
  const protocol = payload?.protocol ?? payload?.server?.protocol ?? payload?.health?.protocol
  if (protocol === "v1" || protocol === "v2") {
    return protocol
  }
  return "unknown" as const
}

export async function detectServerProtocol(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
): Promise<DetectedServerProtocol> {
  if (server.id && typeof window !== "undefined") return probeRegisteredGateway(server, fetch)

  const current = await probe(server, fetch, "/api/health").catch((error) => {
    if (error instanceof ServerProtocolError && (error.code === "AUTH_FAILED" || error.code === "OPENCODE_HEALTH_FAILED")) throw error
    return undefined
  })
  if (current && "healthy" in current && current.healthy === true) return "v2"

  const legacy = await probe(server, fetch, "/global/health").catch((error) => {
    if (error instanceof ServerProtocolError && (error.code === "AUTH_FAILED" || error.code === "OPENCODE_HEALTH_FAILED")) throw error
    return undefined
  })
  if (legacy && "healthy" in legacy && legacy.healthy === true) return "v1"

  return "unknown"
}
