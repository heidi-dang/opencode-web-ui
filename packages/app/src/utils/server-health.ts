import { usePlatform } from "@/context/platform"
import { ServerConnection } from "@/context/server"
import { authTokenFromCredentials, fetchForServer } from "./server"
import { classifyTailscaleServer, type TailscaleDiagnostics } from "./tailscale"
import { Accessor, createEffect, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"

export type ServerHealth = {
  healthy: boolean
  version?: string
  protocol?: "v1" | "v2"
  latencyMs?: number
  error?: string
  reachable?: boolean
  authenticated?: boolean
  tailscale?: TailscaleDiagnostics
}

export function formatServerHealthError(error: string | undefined) {
  switch (error) {
    case "AUTH_FAILED":
      return "Authentication failed. Check the OpenCode server username and password."
    case "CONNECTION_REFUSED":
      return "Server unreachable: connection refused."
    case "CONNECT_TIMEOUT":
      return "Server unreachable: connection timed out."
    case "DNS_RESOLUTION_FAILED":
      return "Server unreachable: DNS resolution failed."
    case "TLS_ERROR":
      return "Server unreachable: TLS negotiation failed."
    case "SERVER_NOT_FOUND":
      return "OpenCode server health endpoint was not found."
    case "MALFORMED_HEALTH_RESPONSE":
    case "PROTOCOL_UNKNOWN":
      return "Unable to determine the OpenCode API protocol."
    case "OPENCODE_HEALTH_FAILED":
      return "OpenCode health check failed."
    case "SERVER_DISABLED":
      return "Server is disabled."
    default:
      return "Server unreachable."
  }
}

interface CheckServerHealthOptions {
  timeoutMs?: number
  signal?: AbortSignal
  retryCount?: number
  retryDelayMs?: number
}

const defaultTimeoutMs = 30_000
const defaultRetryCount = 1
const defaultRetryDelayMs = 500
const cacheMs = 750
const healthCache = new Map<
  string,
  { at: number; done: boolean; fetch: typeof globalThis.fetch; promise: Promise<ServerHealth> }
>()

function cacheKey(server: ServerConnection.HttpBase) {
  return `${server.url}\n${server.username ?? ""}\n${server.password ?? ""}`
}

function timeoutSignal(timeoutMs: number) {
  const timeout = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout
  if (timeout) {
    try {
      return {
        signal: timeout.call(AbortSignal, timeoutMs),
        clear: undefined as (() => void) | undefined,
      }
    } catch {}
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function retryable(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return false
  if (!(error instanceof Error)) return false
  if (error.name === "AbortError" || error.name === "TimeoutError") return false
  if (error instanceof TypeError) return true
  return /network|fetch|econnreset|econnrefused|enotfound|timedout/i.test(error.message)
}

export async function checkServerHealth(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
  opts?: CheckServerHealthOptions,
): Promise<ServerHealth> {
  if (server.id && typeof window !== "undefined") {
    const startedAt = Date.now()
    try {
      const response = await fetch(`/api/opencode/servers/${encodeURIComponent(server.id)}/health`, { signal: opts?.signal })
      const payload = (await response.json()) as {
        healthy?: unknown
        authenticated?: unknown
        reachable?: unknown
        protocol?: "v1" | "v2"
        latencyMs?: unknown
        error?: string
        server?: { state?: string }
      }
      return {
        healthy: payload.healthy === true,
        authenticated: payload.authenticated === true,
        reachable: payload.reachable === true,
        protocol: payload.protocol,
        latencyMs: typeof payload.latencyMs === "number" ? payload.latencyMs : Date.now() - startedAt,
        error: payload.error,
        tailscale: classifyTailscaleServer(server.url),
      }
    } catch {
      return { healthy: false, reachable: false, error: "GATEWAY_UNAVAILABLE", tailscale: classifyTailscaleServer(server.url) }
    }
  }
  const startedAt = Date.now()
  const timeout = opts?.signal ? undefined : timeoutSignal(opts?.timeoutMs ?? defaultTimeoutMs)
  const signal = opts?.signal ?? timeout?.signal
  const retryCount = opts?.retryCount ?? defaultRetryCount
  const retryDelayMs = opts?.retryDelayMs ?? defaultRetryDelayMs
  const next = (count: number, error: unknown) => {
    if (count >= retryCount || !retryable(error, signal)) return Promise.resolve({ healthy: false } as const)
    return wait(retryDelayMs * (count + 1), signal)
      .then(() => attempt(count + 1))
      .catch(() => ({ healthy: false }))
  }
  const request = fetchForServer(server, fetch)
  const tailscale = classifyTailscaleServer(server.url)
  const headers = server.password
    ? { Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}` }
    : undefined
  const attempt = async (count: number): Promise<ServerHealth> => {
    const probe = async (path: string) => {
      const base = server.url.endsWith("/") ? server.url : `${server.url}/`
      const response = await request(new URL(path.replace(/^\//, ""), base), { signal, headers })
      if (response.status < 200 || response.status >= 300) throw new Error(`Health probe returned ${response.status}`)
      const data = (await response.json()) as { healthy?: boolean; version?: string; pid?: number }
      if (typeof data.healthy !== "boolean") throw new Error("Invalid health response")
      return { healthy: data.healthy, version: data.version, pid: data.pid }
    }
    try {
      const current = await probe("/api/health")
      return { healthy: current.healthy, version: current.version, protocol: "v2", latencyMs: Date.now() - startedAt, tailscale }
    } catch (error) {
      if (signal?.aborted) return { healthy: false }
      try {
        const legacy = await probe("/global/health")
        return { ...legacy, protocol: "v1", latencyMs: Date.now() - startedAt, tailscale }
      } catch (legacyError) {
        return next(count, legacyError)
      }
    }
  }
  return attempt(0).finally(() => timeout?.clear?.())
}

const pollMs = 30_000

export function useCheckServerHealth() {
  const platform = usePlatform()
  const fetcher = platform.fetch ?? globalThis.fetch

  return (http: ServerConnection.HttpBase) => {
    const key = cacheKey(http)
    const hit = healthCache.get(key)
    const now = Date.now()
    if (hit && hit.fetch === fetcher && (!hit.done || now - hit.at < cacheMs)) return hit.promise
    const promise = checkServerHealth(http, fetcher).finally(() => {
      const next = healthCache.get(key)
      if (!next || next.promise !== promise) return
      next.done = true
      next.at = Date.now()
    })
    healthCache.set(key, { at: now, done: false, fetch: fetcher, promise })
    return promise
  }
}

export const useServerHealth = (servers: Accessor<ServerConnection.Any[]>, enabled: Accessor<boolean>) => {
  const checkServerHealth = useCheckServerHealth()
  const [status, setStatus] = createStore({} as Record<ServerConnection.Key, ServerHealth | undefined>)

  createEffect(() => {
    if (!enabled()) {
      setStatus(reconcile({}))
      return
    }
    const list = servers()
    let dead = false

    const refresh = async () => {
      const results: Record<string, ServerHealth> = {}
      await Promise.all(
        list.map(async (conn) => {
          const key = ServerConnection.key(conn)
          const result = await checkServerHealth(conn.http)
          results[key] = result
          if (!dead) setStatus(key, result)
        }),
      )
      if (dead) return
      setStatus(reconcile(results))
    }

    void refresh()
    const id = setInterval(() => void refresh(), pollMs)
    onCleanup(() => {
      dead = true
      clearInterval(id)
    })
  })

  return {
    status,
    refresh: () => {
      const list = servers()
      void Promise.all(list.map(async (conn) => {
        const result = await checkServerHealth(conn.http)
        setStatus(ServerConnection.key(conn), result)
      }))
    },
  }
}
