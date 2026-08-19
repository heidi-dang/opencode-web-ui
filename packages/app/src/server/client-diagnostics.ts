import type { IncomingMessage, ServerResponse } from "node:http"
import { runtimeLogger } from "./observability/logger"

const MAX_BODY_BYTES = 16 * 1024
const MAX_STRING_LENGTH = 1_024
const MAX_STACK_LENGTH = 2_048
const ALLOWED_LEVELS = new Set(["trace", "debug", "info", "warn", "error"])
const SAFE_KEYS = new Set(["timestamp", "level", "event", "message", "stack", "route", "requestId", "backendId", "sessionId", "projectId", "protocol", "method", "status", "operation", "errorCode", "userAgent"])
const SENSITIVE_TEXT = /\b(prompt|message|content|text|part|attachment|file|body|cookie|password|token|authorization|secret|credential)\b/i

export type ClientDiagnostic = {
  timestamp?: string
  level: "trace" | "debug" | "info" | "warn" | "error"
  event: string
  message?: string
  stack?: string
  route?: string
  requestId?: string
  backendId?: string
  sessionId?: string
  projectId?: string
  protocol?: string
  method?: string
  status?: number
  operation?: string
  errorCode?: string
  userAgent?: string
}

function bounded(value: unknown, limit: number) {
  return typeof value === "string" && value.length <= limit ? value : undefined
}

function safeText(value: unknown, limit: number) {
  const text = bounded(value, limit)
  if (!text) return undefined
  if (SENSITIVE_TEXT.test(text)) return "client message redacted"
  return text.replace(/\b(Bearer|Basic)\s+[^\s]+/gi, "$1 [REDACTED]")
}

function safeStack(value: unknown) {
  const stack = bounded(value, MAX_STACK_LENGTH)
  if (!stack) return undefined
  const frames = stack.split("\n").slice(1).join("\n")
  return SENSITIVE_TEXT.test(frames) ? "client stack redacted" : frames
}

export function sanitizeClientDiagnostic(value: unknown): ClientDiagnostic | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  let rawSize = 0
  try { rawSize = JSON.stringify(value).length } catch { return undefined }
  if (rawSize > MAX_BODY_BYTES) return undefined
  const input = value as Record<string, unknown>
  const event = bounded(input.event, 80)
  const level = bounded(input.level, 10)
  if (!event || !/^[A-Za-z0-9_.:-]+$/.test(event) || !level || !ALLOWED_LEVELS.has(level)) return undefined
  const output: ClientDiagnostic = { event, level: level as ClientDiagnostic["level"] }
  for (const key of SAFE_KEYS) {
    if (key === "event" || key === "level") continue
    const item = input[key]
    if (item === undefined) continue
    if (key === "message") output.message = safeText(item, MAX_STRING_LENGTH)
    else if (key === "stack") output.stack = safeStack(item)
    else if (key === "status" && typeof item === "number" && Number.isInteger(item) && item >= 100 && item <= 599) output.status = item
    else if (key === "route" && typeof item === "string" && item.startsWith("/") && !item.includes("?")) output.route = bounded(item, 512)
    else if (key === "timestamp" || key === "requestId" || key === "backendId" || key === "sessionId" || key === "projectId" || key === "protocol" || key === "method" || key === "operation" || key === "errorCode" || key === "userAgent") {
      const safe = bounded(item, key === "userAgent" ? 512 : MAX_STRING_LENGTH)
      if (safe) output[key] = key === "userAgent" ? safe.replace(/\s+/g, " ") : safe
    }
  }
  return output
}

export function createClientDiagnosticLimiter(options: { maxEvents: number; windowMs: number; now?: () => number }) {
  const now = options.now || Date.now
  const windows = new Map<string, { started: number; count: number }>()
  return {
    allow(clientKey: string) {
      const current = now()
      const existing = windows.get(clientKey)
      if (!existing || current - existing.started >= options.windowMs) {
        windows.set(clientKey, { started: current, count: 1 })
        return true
      }
      if (existing.count >= options.maxEvents) return false
      existing.count++
      return true
    },
  }
}

const limiter = createClientDiagnosticLimiter({ maxEvents: 30, windowMs: 60_000 })

function json(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.end(JSON.stringify(payload))
}

async function readBoundedBody(req: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new Error("CLIENT_EVENT_TOO_LARGE")
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString("utf8")
}

export async function handleClientDiagnosticsRequest(req: IncomingMessage, res: ServerResponse) {
  if (process.env.WEBUI_CLIENT_ERROR_LOGGING !== "1") return false
  if (req.method !== "POST") return json(res, 405, { error: "METHOD_NOT_ALLOWED" })
  const clientKey = req.socket?.remoteAddress || "unknown"
  if (!limiter.allow(clientKey)) {
    runtimeLogger.warn("client_diagnostic.rate_limited")
    return json(res, 429, { error: "CLIENT_EVENT_RATE_LIMITED" })
  }
  try {
    const body = await readBoundedBody(req)
    const value = JSON.parse(body || "null")
    const diagnostic = sanitizeClientDiagnostic(value)
    if (!diagnostic) {
      runtimeLogger.warn("client_diagnostic.rejected", { reason: "invalid_payload" })
      return json(res, 400, { error: "CLIENT_EVENT_INVALID" })
    }
    runtimeLogger[diagnostic.level]("client." + diagnostic.event, { source: "browser", ...diagnostic })
    res.statusCode = 204
    return res.end()
  } catch (error) {
    const code = error instanceof Error ? error.message : "CLIENT_EVENT_INVALID"
    runtimeLogger.warn("client_diagnostic.rejected", { reason: code })
    return json(res, code === "CLIENT_EVENT_TOO_LARGE" ? 413 : 400, { error: code })
  }
}
