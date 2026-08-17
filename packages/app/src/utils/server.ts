import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/promise"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return btoa(`${input.username ?? "opencode"}:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)
  if (!decoded) return
  const separator = decoded.indexOf(":")
  if (separator === -1) return
  return {
    username: decoded.slice(0, separator) || "opencode",
    password: decoded.slice(separator + 1),
  }
}

export function getProxyEndpoint(serverUrl: string, path = "", queryParams?: Record<string, string>) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`
  const target = new URL(serverUrl)
  const targetOrigin = target.origin
  const basePath = target.pathname.replace(/\/$/, "")
  const browserOrigin = typeof window !== "undefined" ? window.location.origin : ""
  if (!browserOrigin || browserOrigin === "null" || !/^https?:$/.test(new URL(browserOrigin).protocol)) {
    return new URL(`${basePath}${cleanPath}`, `${targetOrigin}/`).toString()
  }
  const url = new URL(`/api/opencode${cleanPath.replace(/^\/api\/opencode/, "")}`, browserOrigin)
  url.searchParams.set("serverId", targetOrigin + basePath)
  for (const [key, value] of Object.entries(queryParams ?? {})) url.searchParams.set(key, value)
  return url.pathname + url.search
}

export function fetchForServer(server: ServerConnection.HttpBase, fetcher: typeof globalThis.fetch = globalThis.fetch) {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof window === "undefined") return fetcher(input, init)
    const serverUrl = new URL(server.url)
    const requestUrl = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      serverUrl,
    )
    if (requestUrl.origin !== serverUrl.origin) return fetcher(input, init)

    const proxyUrl = getProxyEndpoint(server.url, requestUrl.pathname, Object.fromEntries(requestUrl.searchParams))
    const request = input instanceof Request && !init ? new Request(proxyUrl, input) : undefined
    return fetcher(request ?? proxyUrl, init)
  }) as typeof globalThis.fetch
}

export function createSdkForServer({
  server,
  ...config
}: Omit<NonNullable<Parameters<typeof createOpencodeClient>[0]>, "baseUrl"> & {
  server: ServerConnection.HttpBase
}) {
  const auth = (() => {
    if (!server.password) return
    return {
      Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}`,
    }
  })()

  return createOpencodeClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: server.url,
    fetch: fetchForServer(server, config.fetch),
  })
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): OpenCodeClient {
  return OpenCode.make({
    baseUrl: input.server.url,
    fetch: fetchForServer(input.server, input.fetch),
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: input.server.username,
            password: input.server.password,
          })}`,
        }
      : undefined,
  })
}

export type ServerApi = OpenCodeClient
