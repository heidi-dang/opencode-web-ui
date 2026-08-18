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
    const url = new URL(`${basePath}${cleanPath}`, `${target.origin}/`)
    for (const [key, value] of Object.entries(queryParams ?? {})) url.searchParams.set(key, value)
    return url.toString()
  }
  const url = new URL(`/api/opencode${basePath}${cleanPath.replace(/^\/api\/opencode/, "")}`, browserOrigin)
  if (!serverId) throw new Error("SERVER_REGISTRATION_REQUIRED")
  url.searchParams.set("serverId", serverId)
  for (const [key, value] of Object.entries(queryParams ?? {})) url.searchParams.set(key, value)
  return url.pathname + url.search
}

function requestHasBody(init: RequestInit | undefined) {
  return init !== undefined && Object.prototype.hasOwnProperty.call(init, "body")
}

function isReadableStreamBody(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== "undefined" && value instanceof ReadableStream
}

async function prepareBrowserProxyRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  requestUrl: string,
  proxyUrl: string,
) {
  const source = input instanceof Request ? input : new Request(requestUrl, init)
  const request = input instanceof Request && init ? new Request(source, init) : source
  const headers = new Headers(request.headers)
  // The browser owns this header after it has materialized the body.
  headers.delete("content-length")

  const requestInit: RequestInit = {
    cache: request.cache,
    credentials: request.credentials,
    headers,
    integrity: request.integrity,
    keepalive: request.keepalive,
    method: request.method,
    mode: request.mode,
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
    signal: request.signal,
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    const hasExplicitBody = requestHasBody(init)
    const explicitBody = init?.body
    if (hasExplicitBody && explicitBody === null) {
      requestInit.body = null
    } else if (hasExplicitBody && explicitBody !== undefined && !isReadableStreamBody(explicitBody)) {
      // Keep normal BodyInit values (string, Blob, FormData, etc.) untouched.
      requestInit.body = explicitBody
    } else if (request.body) {
      // Request.body is a ReadableStream in browsers, including for JSON created
      // by the generated SDK. Buffer it before calling Safari's fetch().
      requestInit.body = new Uint8Array(await request.clone().arrayBuffer())
    }
  }

  return { input: proxyUrl, init: requestInit }
}

export function fetchForServer(server: ServerConnection.HttpBase, fetcher: typeof globalThis.fetch = globalThis.fetch) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof window === "undefined") return fetcher(input, init)
    const serverUrl = new URL(server.url)
    const requestUrl = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      serverUrl,
    )
    if (requestUrl.origin !== serverUrl.origin) return fetcher(input, init)

    const proxyUrl = getProxyEndpoint(server.url, requestUrl.pathname, Object.fromEntries(requestUrl.searchParams), server.id)
    const absoluteProxyUrl = /^https?:\/\//.test(proxyUrl)
      ? proxyUrl
      : new URL(proxyUrl, window.location.origin).toString()
    const prepared = await prepareBrowserProxyRequest(input, init, requestUrl.toString(), absoluteProxyUrl)
    return fetcher(prepared.input, prepared.init)
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
