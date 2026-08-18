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

export function getProxyEndpoint(serverUrl: string, path = "", queryParams?: Record<string, string>, serverId?: string) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`
  const target = new URL(serverUrl)
  const basePath = target.pathname.replace(/\/$/, "")
  const browserOrigin = typeof window !== "undefined" ? window.location.origin : ""
  if (!browserOrigin || browserOrigin === "null" || !/^https?:$/.test(new URL(browserOrigin).protocol)) {
    return new URL(`${basePath}${cleanPath}`, `${target.origin}/`).toString()
  }
  const url = new URL(`/api/opencode${basePath}${cleanPath.replace(/^\/api\/opencode/, "")}`, browserOrigin)
  if (!serverId) throw new Error("SERVER_REGISTRATION_REQUIRED")
  url.searchParams.set("serverId", serverId)
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

    const proxyUrl = getProxyEndpoint(server.url, requestUrl.pathname, Object.fromEntries(requestUrl.searchParams), server.id)
    const request = input instanceof Request && !init ? new Request(proxyUrl, input) : undefined
    return fetcher(request ?? proxyUrl, init)
  }) as typeof globalThis.fetch
}

function fetchWithV2PromptContract(fetcher: typeof globalThis.fetch) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (request.method !== "POST" || !/^\/api\/session\/[^/]+\/prompt$/.test(url.pathname)) {
      return fetcher(input, init)
    }

    let body: unknown
    try {
      body = JSON.parse(await request.text())
    } catch {
      return fetcher(input, init)
    }

    if (!body || typeof body !== "object" || "prompt" in body || !("text" in body)) {
      return fetcher(input, init)
    }

    const value = body as {
      id?: string
      text: string
      files?: unknown
      agents?: unknown
      delivery?: string
      resume?: boolean
    }
    const next = {
      id: value.id,
      prompt: {
        text: value.text,
        files: value.files,
        agents: value.agents,
      },
      delivery: value.delivery,
      resume: value.resume,
    }
    const headers = new Headers(request.headers)
    headers.set("content-type", "application/json")
    return fetcher(
      new Request(request.url, {
        method: request.method,
        headers,
        body: JSON.stringify(next),
        signal: request.signal,
      }),
    )
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
    fetch: fetchWithV2PromptContract(fetchForServer(input.server, input.fetch)),
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
