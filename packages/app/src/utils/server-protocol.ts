import type { ServerConnection } from "@/context/server"
import { authTokenFromCredentials, getProxyEndpoint } from "./server"

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
  const endpoint = (() => {
    try {
      return getProxyEndpoint(server.url, path)
    } catch {
      return new URL(path.replace(/^\//, ""), server.url.endsWith("/") ? server.url : `${server.url}/`).toString()
    }
  })()
  const response = await fetch(endpoint, {
    headers: headers(server),
    ...(signal ? { signal } : {}),
  })
  if (response.status === 403 && path === "/api/health") {
    const direct = await fetch(new URL(path.replace(/^\//, ""), server.url.endsWith("/") ? server.url : `${server.url}/`), {
      headers: headers(server),
      ...(signal ? { signal } : {}),
    })
    if (!direct.ok) return
    return direct.json().catch(() => undefined)
  }
  const value: unknown = await response.json().catch(() => undefined)
  if (!value || typeof value !== "object") {
    const direct = await fetch(new URL(path.replace(/^\//, ""), server.url.endsWith("/") ? server.url : `${server.url}/`), {
      headers: headers(server),
      ...(signal ? { signal } : {}),
    }).catch(() => undefined)
    if (!direct) return
    const directValue: unknown = await direct.json().catch(() => undefined)
    if (!directValue || typeof directValue !== "object") return
    return directValue
  }
  return value
}

export async function detectServerProtocol(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
): Promise<DetectedServerProtocol> {
  const current = await probe(server, fetch, "/api/health").catch(() => undefined)
  if (current && "pid" in current && typeof current.pid === "number") return "v2"

  const legacy = await probe(server, fetch, "/global/health").catch(() => undefined)
  if (legacy && "healthy" in legacy && legacy.healthy === true) return "v1"
  if (current && "healthy" in current && current.healthy === true) return "v1"

  return "unknown"
}
