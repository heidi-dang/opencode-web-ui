import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { OpenCode, type OpenCodeClient } from "@opencode-ai/client/promise"
import type { ServerConnection } from "@/context/server"
import { decode64 } from "@/utils/base64"

// UTF-8 safe Base64 encoding for Basic Auth credentials.
// btoa() throws on non-ASCII characters, so we encode to bytes first.
function utf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

export function authTokenFromCredentials(input: { username?: string; password: string }) {
  return utf8ToBase64(`${input.username ?? "opencode"}:${input.password}`)
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

export function getEffectiveServerUrl(url: string): string {
  if (!url) return url
  const trimmed = url.trim()
  if (typeof location === "object" && location.protocol === "https:") {
    try {
      const parsed = new URL(trimmed, location.href)
      const current = new URL(location.href)
      const path = parsed.pathname.replace(/\/+$/, "")
      if (parsed.origin === current.origin && (path === "" || path === "/opencode-server")) {
        return `${current.origin}/opencode-server`
      }
    } catch {}
  }
  if (typeof location === "object" && location.protocol === "https:" && trimmed.startsWith("http://")) {
    try {
      const parsed = new URL(trimmed)
      const host = parsed.hostname
      if (!host) return trimmed
      if (parsed.port) {
        const p = parseInt(parsed.port, 10)
        if (isNaN(p) || p < 1 || p > 65535) {
          return trimmed
        }
      }
      const port = parsed.port || "80"
      const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "")
      return `${location.origin}/direct/${host}/${port}${pathname}`
    } catch {
      return trimmed
    }
  }
  return trimmed
}

function createBasePathFetch(fetcher: typeof globalThis.fetch, base: URL): typeof globalThis.fetch {
  const basePath = base.pathname.replace(/\/+$/, "")
  const rewrite = (input: RequestInfo | URL) => {
    if (!basePath) return
    const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const url = new URL(raw, base)
    if (url.origin !== base.origin) return
    if (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`)) return
    url.pathname = `${basePath}${url.pathname === "/" ? "" : url.pathname}`
    return url
  }

  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = rewrite(input)
      if (!url) return fetcher(input, init)
      if (!(input instanceof Request)) return fetcher(input instanceof URL ? url : url.toString(), init)

      // Passing a cloned Request forwards its body as a ReadableStream, which WebKit
      // cannot upload. Materialize rewritten request bodies before calling fetch.
      const request = new Request(input, init)
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer()
      return fetcher(url.toString(), {
        method: request.method,
        headers: request.headers,
        body,
        cache: request.cache,
        credentials: request.credentials,
        integrity: request.integrity,
        keepalive: request.keepalive,
        mode: request.mode,
        redirect: request.redirect,
        referrer: request.referrer,
        referrerPolicy: request.referrerPolicy,
        signal: request.signal,
      })
    },
    { preconnect: fetcher.preconnect },
  )
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

  const parsed = new URL(getEffectiveServerUrl(server.url), typeof location === "object" ? location.href : "http://localhost")

  const customFetch = createBasePathFetch(config.fetch ?? globalThis.fetch, parsed)

  return createOpencodeClient({
    ...config,
    headers: {
      ...(config.headers instanceof Headers ? Object.fromEntries(config.headers.entries()) : config.headers),
      ...auth,
    },
    baseUrl: parsed.origin,
    fetch: customFetch,
  })
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): OpenCodeClient {
  const parsed = new URL(getEffectiveServerUrl(input.server.url), typeof location === "object" ? location.href : "http://localhost")

  const customFetch = createBasePathFetch(input.fetch ?? globalThis.fetch, parsed)

  const client = OpenCode.make({
    baseUrl: parsed.origin,
    fetch: customFetch,
    headers: input.server.password
      ? {
          Authorization: `Basic ${authTokenFromCredentials({
            username: input.server.username,
            password: input.server.password,
          })}`,
        }
      : undefined,
  })

  // The promise client shipped with older generated contracts serializes the
  // prompt field incorrectly for current servers. Keep the compatibility API
  // stable, but send the authoritative v2 request body explicitly.
  return {
    ...client,
    session: {
      ...client.session,
      prompt: async (value: any) => {
        const response = await customFetch(
          new URL(`/api/session/${encodeURIComponent(value.sessionID)}/prompt`, parsed.origin),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: value.id, prompt: value.prompt, delivery: value.delivery, resume: value.resume }),
          },
        )
        if (!response.ok) throw new Error(`Prompt request failed (${response.status})`)
        return response.json()
      },
    },
  } as OpenCodeClient
}

export type ServerApi = OpenCodeClient
