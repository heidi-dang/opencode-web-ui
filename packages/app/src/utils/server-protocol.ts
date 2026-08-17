import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials, fetchForServer } from "./server"

export type ServerProtocol = "v1" | "v2"
export type DetectedServerProtocol = ServerProtocol | "unknown"

export class ServerProtocolError extends Error {
  readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = "ServerProtocolError"
    this.cause = cause
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
  if (!response.ok) throw new Error(`Protocol probe returned ${response.status}`)
  const value: unknown = await response.json()
  if (!value || typeof value !== "object") throw new Error("Protocol probe returned malformed JSON")
  return value
}

export async function detectServerProtocol(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
): Promise<DetectedServerProtocol> {
  const current = await probe(server, fetch, "/api/health").catch(() => undefined)
  if (current && "healthy" in current && current.healthy === true) return "v2"

  const legacy = await probe(server, fetch, "/global/health").catch(() => undefined)
  if (legacy && "healthy" in legacy && legacy.healthy === true) return "v1"

  return "unknown"
}
