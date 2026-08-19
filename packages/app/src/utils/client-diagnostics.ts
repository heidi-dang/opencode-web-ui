type ClientDiagnosticFields = Record<string, unknown>
type ClientDiagnosticsOptions = { enabled: boolean; fetcher?: typeof fetch; now?: () => number }

const ALLOWED_KEYS = new Set(["timestamp", "message", "stack", "route", "requestId", "backendId", "sessionId", "projectId", "protocol", "method", "status", "operation", "errorCode", "userAgent"])
const SENSITIVE_TEXT = /\b(prompt|message|content|text|part|attachment|file|body|cookie|password|token|authorization|secret|credential)\b/i
const MAX_EVENTS = 20
const WINDOW_MS = 60_000

function bounded(value: unknown, limit: number) {
  return typeof value === "string" && value.length <= limit ? value : undefined
}

function safeText(value: unknown, limit = 1_024) {
  const text = bounded(value, limit)
  if (!text) return undefined
  if (SENSITIVE_TEXT.test(text)) return "client message redacted"
  return text.replace(/\b(Bearer|Basic)\s+[^\s]+/gi, "$1 [REDACTED]")
}

function safeFields(fields: ClientDiagnosticFields) {
  const result: ClientDiagnosticFields = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_KEYS.has(key)) continue
    if (key === "message") result[key] = safeText(value)
    else if (key === "stack") {
      const stack = bounded(value, 2_048)
      if (stack) result[key] = SENSITIVE_TEXT.test(stack) ? "client stack redacted" : stack.split("\n").slice(1).join("\n")
    } else if (key === "status") {
      if (typeof value === "number" && Number.isInteger(value)) result[key] = value
    } else {
      const safe = bounded(value, key === "userAgent" ? 512 : 1_024)
      if (safe) result[key] = key === "route" ? safe.split("?")[0] : safe
    }
  }
  return result
}

function errorFields(reason: unknown) {
  if (reason instanceof Error) return { message: reason.message, stack: reason.stack }
  if (reason && typeof reason === "object") {
    const value = reason as { message?: unknown; stack?: unknown; name?: unknown }
    return { message: value.message || value.name, stack: value.stack }
  }
  return { message: reason }
}

export function createClientDiagnostics(options: ClientDiagnosticsOptions) {
  const fetcher = options.fetcher || fetch
  const now = options.now || Date.now
  let sent = 0
  let windowStarted = 0
  let sending = false

  async function report(event: string, fields: ClientDiagnosticFields = {}) {
    if (!options.enabled || !/^[A-Za-z0-9_.:-]{1,80}$/.test(event)) return
    const current = now()
    if (current - windowStarted >= WINDOW_MS) { windowStarted = current; sent = 0 }
    if (sent >= MAX_EVENTS || sending) return
    sent++
    sending = true
    const payload = { timestamp: new Date(current).toISOString(), level: "error", event, route: typeof location === "undefined" ? undefined : location.pathname, userAgent: typeof navigator === "undefined" ? undefined : navigator.userAgent, ...safeFields(fields) }
    try {
      await fetcher("/api/debug/client-events", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(payload), keepalive: true })
    } catch {
      // Telemetry failures are deliberately terminal and never report through this path.
    } finally {
      sending = false
    }
  }

  function install() {
    if (!options.enabled || typeof window === "undefined") return () => undefined
    const onError = (event: ErrorEvent) => { void report("window.error", { message: event.message, stack: event.error?.stack }) }
    const onRejection = (event: PromiseRejectionEvent) => { void report("window.unhandledrejection", errorFields(event.reason)) }
    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRejection)
    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRejection)
    }
  }

  return {
    report,
    install,
    reportApiFailure(response: Response, fields: ClientDiagnosticFields = {}) {
      return report("api.failure", { ...fields, method: fields.method || "GET", status: response.status, requestId: response.headers.get("x-request-id") || undefined })
    },
    reportSseFailure(fields: ClientDiagnosticFields = {}) {
      return report("sse.error", fields)
    },
  }
}

export const clientDiagnostics = createClientDiagnostics({ enabled: import.meta.env.VITE_WEBUI_CLIENT_ERROR_LOGGING === "1" })
export const reportClientDiagnostic = clientDiagnostics.report
