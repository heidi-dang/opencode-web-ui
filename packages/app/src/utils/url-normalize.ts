/**
 * Canonical URL Normalization Module
 * Enforces unified parsing, validation, protocol handling, proxy route derivation,
 * and WebSocket derivation for OpenCode server URLs.
 */

export interface NormalizedServerEndpoint {
  /** The canonical normalized HTTP/HTTPS base URL (e.g. "http://100.111.125.40:4096" or "https://heidi-dev.ts.net:4096") */
  url: string
  /** The scheme: "http" | "https" */
  protocol: "http" | "https"
  /** The hostname or IP address (e.g. "100.111.125.40", "[::1]", "heidi-dev.ts.net") */
  host: string
  /** Port number if non-default, or undefined if default */
  port?: number
  /** Base path if present (e.g. "/opencode-server" or "") */
  basePath: string
  /** Derived WebSocket base URL (e.g. "ws://..." or "wss://...") */
  wsUrl: string
  /** Stable server identity key */
  serverId: string
}

/**
 * Normalizes a raw user input or stored string into a canonical server URL.
 * Returns undefined if the URL is invalid or malformed.
 */
export function normalizeServerUrl(input: string): string | undefined {
  const parsed = parseServerEndpoint(input)
  return parsed?.url
}

/**
 * Parses a raw URL string into a structured NormalizedServerEndpoint.
 */
export function parseServerEndpoint(input: string): NormalizedServerEndpoint | undefined {
  if (!input) return undefined
  let str = input.trim()
  if (!str) return undefined

  // Reject query parameters or fragments
  if (str.includes("?") || str.includes("#")) {
    return undefined
  }

  // Handle duplicate protocol prefixes e.g. "http://https://" or "http://http://"
  while (/^https?:\/\/(https?:\/\/)/i.test(str)) {
    str = str.replace(/^https?:\/\//i, "")
  }

  // If a scheme is explicitly provided, verify it is http or https
  if (/^[a-z0-9+.-]+:\/\//i.test(str)) {
    if (!/^https?:\/\//i.test(str)) {
      return undefined
    }
  } else {
    str = `http://${str}`
  }

  try {
    const urlObj = new URL(str)

    // Only http and https allowed
    if (urlObj.protocol !== "http:" && urlObj.protocol !== "https:") {
      return undefined
    }

    const protocol = urlObj.protocol.slice(0, -1) as "http" | "https"
    let hostname = urlObj.hostname.toLowerCase()

    // Handle bracketed IPv6 normalization
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      hostname = hostname.toLowerCase()
    }

    let port: number | undefined
    if (urlObj.port) {
      const parsedPort = parseInt(urlObj.port, 10)
      if (isNaN(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
        return undefined
      }
      // Omit default ports
      if ((protocol === "http" && parsedPort !== 80) || (protocol === "https" && parsedPort !== 443)) {
        port = parsedPort
      }
    }

    // Clean base path (strip trailing slashes)
    let basePath = urlObj.pathname.replace(/\/+$/, "")
    if (basePath === "/") basePath = ""

    const hostWithPort = port ? `${hostname}:${port}` : hostname
    const canonicalUrl = `${protocol}://${hostWithPort}${basePath}`

    const wsProtocol = protocol === "https" ? "wss" : "ws"
    const wsUrl = `${wsProtocol}://${hostWithPort}${basePath}`
    const serverId = canonicalUrl

    return {
      url: canonicalUrl,
      protocol,
      host: hostname,
      port,
      basePath,
      wsUrl,
      serverId,
    }
  } catch {
    return undefined
  }
}

/**
 * Checks if the current page execution context is hosted HTTPS (e.g. https://ai.tnaprovider.com.au).
 */
export function isHostedHttpsContext(origin?: string): boolean {
  const currentOrigin = origin ?? (typeof location === "object" ? location.origin : "")
  return currentOrigin.startsWith("https://")
}

/**
 * Derives the effective API base URL for a server.
 * If the page is hosted over HTTPS and the target server is HTTP or a direct IP/hostname on Tailscale,
 * it routes through the same-origin `/direct/<host>/<port>` proxy.
 */
export function getEffectiveServerUrl(targetUrl: string, pageOrigin?: string): string {
  const parsed = parseServerEndpoint(targetUrl)
  if (!parsed) return targetUrl

  const origin = pageOrigin ?? (typeof location === "object" ? location.origin : "")
  if (!origin || !origin.startsWith("https://")) {
    return parsed.url
  }

  // If target server is already same-origin or HTTPS on a public domain, direct is safe
  if (parsed.url.startsWith(origin)) {
    return parsed.url
  }

  // If the target is HTTP or a private/Tailscale target, route through same-origin /direct proxy
  const port = parsed.port ?? (parsed.protocol === "https" ? 443 : 80)
  const basePathSuffix = parsed.basePath ? parsed.basePath : ""
  return `${origin}/direct/${parsed.host}/${port}${basePathSuffix}`
}

/**
 * Derives the WebSocket URL for a given target server, considering proxy routing if hosted over HTTPS.
 */
export function getEffectiveWebSocketUrl(targetUrl: string, pageOrigin?: string): string {
  const effectiveHttpUrl = getEffectiveServerUrl(targetUrl, pageOrigin)
  const parsed = parseServerEndpoint(effectiveHttpUrl)
  if (parsed) return parsed.wsUrl
  return targetUrl.replace(/^http/, "ws")
}
