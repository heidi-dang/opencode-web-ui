import { getRequestContext } from "./request-context"

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error"
export type LogFields = Record<string, unknown>

export type LogRecord = {
  timestamp: string
  level: LogLevel
  component: string
  event: string
  [key: string]: unknown
}

type LoggerOptions = {
  component?: string
  level?: LogLevel
  format?: "json" | "pretty"
  sink?: (record: LogRecord) => void
}

const LEVELS: Record<LogLevel, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50 }
const SENSITIVE_KEY = /^(?:authorization|cookie|set-cookie|password|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|credential|credentials|encryption[_-]?key|app[_-]?encryption[_-]?key|body|prompt|content|file|files)$/i
const SENSITIVE_QUERY = /^(?:token|access[_-]?token|refresh[_-]?token|key|api[_-]?key|secret|password|auth|authorization|credential|code)$/i
const MAX_STRING = 2_000
const MAX_DEPTH = 5

function configuredLevel(): LogLevel {
  const value = typeof process !== "undefined" ? process.env.WEBUI_LOG_LEVEL : undefined
  return value && value in LEVELS ? value as LogLevel : "info"
}

function configuredFormat(): "json" | "pretty" {
  const value = typeof process !== "undefined" ? process.env.WEBUI_LOG_FORMAT : undefined
  return value === "pretty" ? "pretty" : "json"
}

function redactString(value: string) {
  let result = value.slice(0, MAX_STRING)
  result = result.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/._=-]+/gi, "$1 [REDACTED]")
  result = result.replace(/(authorization|cookie|set-cookie|password|token|api[_-]?key|secret)=([^\s&]+)/gi, "$1=[REDACTED]")
  try {
    const url = new URL(result)
    url.username = ""
    url.password = ""
    for (const key of [...url.searchParams.keys()]) if (SENSITIVE_QUERY.test(key)) url.searchParams.set(key, "[REDACTED]")
    url.hash = ""
    return url.toString()
  } catch {
    return result
  }
}

function sanitize(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_DEPTH) return "[Truncated]"
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value
  if (typeof value === "string") return redactString(value)
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      ...(value.stack ? { stack: redactString(value.stack) } : {}),
    }
  }
  if (typeof value !== "object") return String(value)
  if (seen.has(value)) return "[Circular]"
  seen.add(value)
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1, seen))
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      result[key] = "[REDACTED]"
      continue
    }
    if (key === "url" || key === "endpoint" || key === "baseUrl" || key === "upstreamUrl") {
      result[key] = typeof item === "string" ? redactString(item) : "[REDACTED]"
      continue
    }
    result[key] = sanitize(item, depth + 1, seen)
  }
  return result
}

export function normalizeRequestId(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) return undefined
  return value
}

export function sanitizeLogFields(fields: LogFields = {}) {
  return sanitize(fields, 0, new WeakSet()) as LogFields
}

function defaultSink(record: LogRecord) {
  const line = JSON.stringify(record)
  if (typeof process !== "undefined" && process.stdout?.write) process.stdout.write(`${line}\n`)
  else console.log(line)
}

export function createLogger(options: LoggerOptions = {}) {
  const component = options.component || "webui"
  const level = options.level || configuredLevel()
  const format = options.format || configuredFormat()
  const sink = options.sink || defaultSink

  function write(levelName: LogLevel, event: string, fields: LogFields = {}) {
    if (LEVELS[levelName] < LEVELS[level]) return
    const context = getRequestContext()
    const safeFields = sanitizeLogFields({ ...(context || {}), ...fields })
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level: levelName,
      component,
      event,
      ...safeFields,
    }
    sink(record)
  }

  return {
    trace: (event: string, fields?: LogFields) => write("trace", event, fields),
    debug: (event: string, fields?: LogFields) => write("debug", event, fields),
    info: (event: string, fields?: LogFields) => write("info", event, fields),
    warn: (event: string, fields?: LogFields) => write("warn", event, fields),
    error: (event: string, fields?: LogFields) => write("error", event, fields),
    serialize: (record: LogRecord) => format === "pretty" ? `${record.timestamp} ${record.level.toUpperCase()} ${record.component} ${record.event} ${JSON.stringify(record)}` : JSON.stringify(record),
    level,
    format,
  }
}

export const runtimeLogger = createLogger({ component: "runtime" })
