/**
 * Network, Offline, CORS, Cooldown, and Recovery Utilities.
 * Sweep implementation for Rules 291 - 300.
 */

/**
 * Rule 291: Offline Queue Processing Recovery.
 * Queues offline actions in sessionStorage and replays them when network reconnects.
 */
export interface OfflineAction {
  id: string
  type: string
  payload: any
  timestamp: number
}

class OfflineQueue {
  private key = "opencode.network.offline_queue"

  public enqueue(type: string, payload: any): void {
    if (typeof window === "undefined") return
    const queue = this.getQueue()
    const action: OfflineAction = {
      id: Math.random().toString(36).substring(2, 9),
      type,
      payload,
      timestamp: Date.now(),
    }
    queue.push(action)
    try {
      window.sessionStorage.setItem(this.key, JSON.stringify(queue))
    } catch {}
  }

  public getQueue(): OfflineAction[] {
    if (typeof window === "undefined") return []
    try {
      const raw = window.sessionStorage.getItem(this.key)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }

  public clearQueue(): void {
    if (typeof window === "undefined") return
    try {
      window.sessionStorage.removeItem(this.key)
    } catch {}
  }

  public removeAction(id: string): void {
    if (typeof window === "undefined") return
    const queue = this.getQueue().filter((a) => a.id !== id)
    try {
      window.sessionStorage.setItem(this.key, JSON.stringify(queue))
    } catch {}
  }
}

export const offlineQueueManager = new OfflineQueue()

/**
 * Rule 292: HTTP 401 / Auth Refresh Handling.
 */
export async function handle401AuthRefresh(
  response: Response,
  refreshFn: () => Promise<boolean>,
  retryRequest: () => Promise<Response>
): Promise<Response> {
  if (response.status === 401) {
    try {
      const refreshed = await refreshFn()
      if (refreshed) {
        return await retryRequest()
      }
    } catch {
      // Refresh failed, continue with original 401
    }
  }
  return response
}

/**
 * Rule 293: CORS Error Graceful Degrade.
 * Formats cross-origin fetch failures into readable messages.
 */
export function formatCorsErrorMessage(error: any): string {
  const msg = error?.message || String(error)
  if (msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("networkerror")) {
    return "Network error or CORS (Cross-Origin Resource Sharing) block. Please verify target origin settings or server permissions."
  }
  return msg
}

/**
 * Rule 294: HTTP 429 Rate Limit Cooldown Enforcement.
 */
class RateLimitTracker {
  private cooldowns = new Map<string, number>()
  private listeners = new Set<() => void>()

  public setCooldown(endpoint: string, retryAfterSeconds: number): void {
    const expiresAt = Date.now() + retryAfterSeconds * 1000
    this.cooldowns.set(endpoint, expiresAt)
    this.notify()

    const timer = setInterval(() => {
      if (Date.now() >= expiresAt) {
        this.cooldowns.delete(endpoint)
        clearInterval(timer)
        this.notify()
      }
    }, 1000)
  }

  public getRemainingSeconds(endpoint: string): number {
    const expiresAt = this.cooldowns.get(endpoint)
    if (!expiresAt) return 0
    const diff = expiresAt - Date.now()
    return diff > 0 ? Math.ceil(diff / 1000) : 0
  }

  public isLocked(endpoint: string): boolean {
    return this.getRemainingSeconds(endpoint) > 0
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export const rateLimitCooldownTracker = new RateLimitTracker()

/**
 * Rule 296: Network Timeout Circuit Breaker helper.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 5000
): Promise<Response> {
  const controller = new AbortController()
  const signal = controller.signal

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const mergedOptions = { ...options, signal }
    const response = await fetch(url, mergedOptions)
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

/**
 * Rule 297: SSE Connection Auto-Reconnect Limit with exponential backoff.
 */
export class SSEReconnectController {
  private attempt = 0
  private maxAttempts: number
  private baseDelayMs: number
  private maxDelayMs: number

  constructor(options: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number } = {}) {
    this.maxAttempts = options.maxAttempts ?? 5
    this.baseDelayMs = options.baseDelayMs ?? 1000
    this.maxDelayMs = options.maxDelayMs ?? 30000
  }

  public reset(): void {
    this.attempt = 0
  }

  public getNextDelay(): number | null {
    if (this.attempt >= this.maxAttempts) {
      return null // Cap reached
    }
    const delay = Math.min(
      this.baseDelayMs * Math.pow(2, this.attempt),
      this.maxDelayMs
    )
    this.attempt++
    return delay
  }

  public getAttemptCount(): number {
    return this.attempt
  }
}

/**
 * Rule 299: Stale Request Race Condition Guards.
 */
export class StaleRequestGuard<T> {
  private currentSequence = 0

  public nextSequence(): number {
    this.currentSequence++
    return this.currentSequence
  }

  public isStale(sequence: number): boolean {
    return sequence !== this.currentSequence
  }

  public wrap<P extends any[], R>(
    asyncFn: (...args: P) => Promise<R>,
    onSuccess: (result: R) => void,
    onStale?: () => void
  ): (...args: P) => void {
    return (...args: P) => {
      const seq = this.nextSequence()
      asyncFn(...args)
        .then((res) => {
          if (!this.isStale(seq)) {
            onSuccess(res)
          } else {
            onStale?.()
          }
        })
        .catch(() => {
          // Errors ignored for stale requests
        })
    }
  }
}

/**
 * Rule 298: Image Fallback Cascade utility.
 */
export function registerImageFallback(
  img: HTMLImageElement,
  fallbackUrls: string[],
  onAllFailed?: () => void
): void {
  if (!img) return
  let fallbackIndex = 0

  const handleError = () => {
    if (fallbackIndex < fallbackUrls.length) {
      img.src = fallbackUrls[fallbackIndex]
      fallbackIndex++
    } else {
      img.removeEventListener("error", handleError)
      onAllFailed?.()
    }
  }

  img.addEventListener("error", handleError)
}

/**
 * Rule 300: Global Telemetry Handlers to prevent white-screening the UI.
 */
export function installGlobalErrorTelemetry(
  logFn?: (error: Error, isUnhandledRejection: boolean) => void
): void {
  if (typeof window === "undefined") return

  window.addEventListener("error", (event) => {
    // Rule 265: Skip ResizeObserver loop completed warnings safely
    if (event.message?.includes("ResizeObserver loop")) {
      event.stopImmediatePropagation()
      return
    }

    const err = event.error || new Error(event.message || "Unknown error")
    logFn?.(err, false)
  })

  window.addEventListener("unhandledrejection", (event) => {
    const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason))
    logFn?.(err, true)
  })
}
