import type { BackendType } from "./domain"

export type BackendEventType = "BACKEND_READY" | "BACKEND_UNHEALTHY" | "SESSION_CREATED" | "SESSION_STARTED" | "SESSION_IDLE" | "SESSION_ERROR" | "SESSION_INTERRUPTED" | "MESSAGE_START" | "MESSAGE_DELTA" | "MESSAGE_END" | "TOOL_START" | "TOOL_UPDATE" | "TOOL_END" | "PERMISSION_REQUEST" | "AGENT_STARTED" | "AGENT_STATUS" | "AGENT_FINISHED" | "ERROR"

export type BackendEvent = {
  id: string
  sequence: number
  backendId: string
  backendType: BackendType
  sessionId?: string
  type: BackendEventType
  timestamp: string
  payload?: unknown
  extensions?: Record<string, unknown>
}

export const isCriticalEvent = (event: BackendEvent) => ["SESSION_IDLE", "TOOL_END", "ERROR", "PERMISSION_REQUEST"].includes(event.type)
