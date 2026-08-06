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

  const customFetch = (reqUrl: RequestInfo | URL, init?: RequestInit) => {
    let finalStr = typeof reqUrl === "string" ? reqUrl : reqUrl instanceof URL ? reqUrl.toString() : reqUrl.url
    if (parsed.pathname !== "/" && parsed.pathname !== "") {
      if (finalStr.startsWith(parsed.origin)) {
        const u = new URL(finalStr)
        if (!u.pathname.startsWith(parsed.pathname)) {
          u.pathname = parsed.pathname + (u.pathname === "/" ? "" : u.pathname)
          finalStr = u.toString()
        }
      }
    }
    return (config.fetch ?? globalThis.fetch)(finalStr, init)
  }

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

  const customFetch = (reqUrl: RequestInfo | URL, init?: RequestInit) => {
    let finalStr = typeof reqUrl === "string" ? reqUrl : reqUrl instanceof URL ? reqUrl.toString() : reqUrl.url
    if (parsed.pathname !== "/" && parsed.pathname !== "") {
      if (finalStr.startsWith(parsed.origin)) {
        const u = new URL(finalStr)
        if (!u.pathname.startsWith(parsed.pathname)) {
          u.pathname = parsed.pathname + (u.pathname === "/" ? "" : u.pathname)
          finalStr = u.toString()
        }
      }
    }
    return (input.fetch ?? globalThis.fetch)(finalStr, init)
  }

  return OpenCode.make({
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
}

export type ServerApi = OpenCodeClient
