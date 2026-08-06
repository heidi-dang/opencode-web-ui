import { usePlatform } from "@/context/platform"
import { ServerConnection } from "@/context/server"
import { authTokenFromCredentials, createSdkForServer, getEffectiveServerUrl, createApiForServer } from "./server"
import { ClientError, OpenCode } from "@opencode-ai/client"
import { Accessor, createEffect, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"

export type ServerHealth = { healthy: boolean; version?: string; provider?: string; model?: string; requiresAuth?: boolean; authFailed?: boolean }

interface CheckServerHealthOptions {
  timeoutMs?: number
  signal?: AbortSignal
  retryCount?: number
  retryDelayMs?: number
}

const defaultTimeoutMs = 30_000
const defaultRetryCount = 2
const defaultRetryDelayMs = 100
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
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException("Aborted", "AbortError"))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

function retryable(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return false
  if (error instanceof ClientError) {
    const status = (error as { status?: number }).status
    if (status === 401 || status === 403) return false
    if (status !== undefined && status >= 400 && status < 500) return false
  }
  return true
}

export function checkServerHealth(
  server: ServerConnection.HttpBase,
  fetch: typeof globalThis.fetch,
  opts?: CheckServerHealthOptions,
): Promise<ServerHealth> {
  const key = cacheKey(server)
  const cached = healthCache.get(key)
  const now = Date.now()
  if (cached && cached.fetch === fetch && (cached.done ? now - cached.at < cacheMs : now - cached.at < defaultTimeoutMs)) {
    return cached.promise
  }

  const { signal: timeoutSig, clear } = timeoutSignal(opts?.timeoutMs ?? defaultTimeoutMs)
  const signal = opts?.signal ? AbortSignal.any([opts.signal, timeoutSig]) : timeoutSig
  const retryCount = opts?.retryCount ?? defaultRetryCount
  const retryDelayMs = opts?.retryDelayMs ?? defaultRetryDelayMs
  const next = (count: number, error: unknown) => {
    if (count >= retryCount || !retryable(error, signal)) return Promise.resolve({ healthy: false } as const)
    return wait(retryDelayMs * (count + 1), signal)
      .then(() => attempt(count + 1))
      .catch(() => ({ healthy: false }))
  }
  const attempt = async (count: number): Promise<ServerHealth> => {
    const effectiveUrl = getEffectiveServerUrl(server.url)
    const authHeaders = server.password
      ? { Authorization: `Basic ${authTokenFromCredentials({ username: server.username, password: server.password })}` }
      : undefined

    const processRes = async (res: Response | null): Promise<ServerHealth | null> => {
      if (!res) return null
      if (res.ok) {
        const json = await res.json().catch(() => ({}))
        return { healthy: json.healthy !== false, version: json.version, provider: json.provider, model: json.model }
      }
      if (res.status === 401 || res.status === 403) {
        return {
          healthy: false,
          requiresAuth: true,
          authFailed: Boolean(server.username || server.password),
        }
      }
      return null
    }

    // Direct / Proxy Probe for raw status check
    try {
      const probePaths = ["/health", "/global/health", "/api/health"]
      for (const path of probePaths) {
        try {
          const res = await fetch(new URL(path, effectiveUrl).toString(), { headers: authHeaders, signal }).catch(() => null)
          const result = await processRes(res)
          if (result) {
             if (result.healthy && !result.provider) {
               try {
                 const api = createApiForServer({ server, fetch })
                 const defaultModel = await api.model.default()
                 if (defaultModel?.data) {
                   result.provider = defaultModel.data.providerID
                   result.model = defaultModel.data.id
                 }
               } catch (e) {}
             }
             return result
          }
        } catch {}
      }
    } catch {}

    const current = await OpenCode.make({
      baseUrl: effectiveUrl,
      fetch,
      headers: authHeaders,
    })
      .health.get({ signal })
      .then((x) =>
        typeof x.healthy === "boolean"
          ? { data: { healthy: x.healthy, version: x.version } }
          : { error: new Error("Invalid health response") },
      )
      .catch((error) => ({ error }))
    if ("data" in current && current.data) return current.data
    if (signal?.aborted) return { healthy: false }

    const sdk = createSdkForServer({ server, fetch, signal })
    return sdk
      .global.health()
      .then(async (x) => {
        if (x.error) return next(count, x.error)
        let provider, model;
        if (x.data?.healthy) {
          try {
             const api = createApiForServer({ server, fetch })
             const defaultModel = await api.model.default()
             if (defaultModel?.data) {
               provider = defaultModel.data.providerID
               model = defaultModel.data.id
             }
          } catch (e) {}
        }
        return { healthy: x.data?.healthy === true, version: x.data?.version, provider, model }
      })
      .catch((error) => next(count, error))
  }
  return attempt(0).finally(() => clear?.())
}

const pollMs = 10_000

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
          if (!conn || conn.type !== "http" || !conn.http || !conn.http.url) return
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

  return status
}
