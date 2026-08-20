import type { AgentExecutionEvent, AgentExecutionState, AgentRuntimeSnapshot, ContextUsageSnapshot } from "./contracts"
import { normalizeAgentState } from "./contracts"

type RuntimeEvent = {
  type?: string
  properties?: Record<string, unknown>
}

const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined)
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

function sessionID(event: RuntimeEvent) {
  return text(event.properties?.sessionID) ?? text(event.properties?.sessionId)
}

function eventID(event: RuntimeEvent, index: number) {
  return text(event.properties?.id) ?? `${event.type ?? "runtime"}:${sessionID(event) ?? "unknown"}:${index}`
}

function activityFor(type: string): AgentExecutionEvent["kind"] {
  if (type.includes("permission")) return "waiting"
  if (type.includes("error") || type.includes("failure")) return "failure"
  if (type.includes("abort") || type.includes("cancel")) return "cancellation"
  if (type.includes("tool") || type.includes("part")) return "network"
  if (type.includes("message")) return "reasoning"
  if (type.includes("session")) return "completion"
  return "waiting"
}

function stateFor(type: string): AgentExecutionEvent["state"] {
  if (type.includes("error") || type.includes("failure")) return "failed"
  if (type.includes("abort") || type.includes("cancel")) return "cancelled"
  if (type.endsWith("completed") || type.endsWith("finished") || type === "session.idle") return "completed"
  return "active"
}

/** Converts official OpenCode SSE payloads into the workspace's stable UI event contract. */
export function normalizeRuntimeEvent(event: RuntimeEvent, index = 0, timestamp = Date.now()): AgentExecutionEvent | undefined {
  const type = text(event.type)
  if (!type) return undefined
  const properties = event.properties ?? {}
  const label = text(properties.title) ?? text(properties.name) ?? text(properties.message) ?? type
  return {
    id: eventID(event, index),
    agentId: sessionID(event),
    kind: activityFor(type),
    label,
    timestamp: number(properties.timestamp) ?? timestamp,
    durationMs: number(properties.durationMs),
    state: stateFor(type),
    detail: text(properties.detail) ?? text(properties.status),
    output: text(properties.output),
  }
}

export function runtimeAgentSnapshot(event: RuntimeEvent, previous?: AgentRuntimeSnapshot, timestamp = Date.now()): AgentRuntimeSnapshot | undefined {
  const id = sessionID(event)
  if (!id) return previous
  const properties = event.properties ?? {}
  const type = event.type ?? ""
  const state: AgentExecutionState = normalizeAgentState(
    text(properties.state) ?? (type.includes("error") ? "failed" : type.includes("idle") || type.includes("completed") ? "completed" : "working"),
  )
  return {
    id,
    parentId: text(properties.parentSessionID) ?? text(properties.parentId) ?? previous?.parentId,
    label: text(properties.title) ?? previous?.label ?? id,
    task: text(properties.prompt) ?? text(properties.task) ?? previous?.task,
    model: previous?.model,
    state,
    activity: text(properties.status) ?? previous?.activity,
    currentTool: text(properties.tool) ?? previous?.currentTool,
    currentFile: text(properties.file) ?? previous?.currentFile,
    elapsedMs: previous?.updatedAt ? Math.max(0, timestamp - previous.updatedAt) : previous?.elapsedMs,
    progress: number(properties.progress) ?? previous?.progress,
    updatedAt: timestamp,
  }
}

export function contextUsageFromRuntime(value: unknown): ContextUsageSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined
  const record = value as Record<string, unknown>
  const tokens = record.tokens && typeof record.tokens === "object" ? (record.tokens as Record<string, unknown>) : record
  const inputTokens = number(tokens.input) ?? number(record.inputTokens)
  const outputTokens = number(tokens.output) ?? number(record.outputTokens)
  const contextUsed = number(record.contextUsed) ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined)
  if (inputTokens === undefined && outputTokens === undefined && contextUsed === undefined) return undefined
  return {
    model: { providerID: text(record.providerID), modelID: text(record.modelID) },
    inputTokens,
    outputTokens,
    totalTokens: number(record.totalTokens) ?? contextUsed,
    contextUsed,
    contextLimit: number(record.contextLimit),
    cost: number(record.cost),
    updatedAt: Date.now(),
  }
}

export function createRuntimeEventBuffer(limit = 500) {
  const events: AgentExecutionEvent[] = []
  const seen = new Set<string>()
  return {
    push(event: AgentExecutionEvent | undefined) {
      if (!event || seen.has(event.id)) return events
      seen.add(event.id)
      events.push(event)
      if (events.length > limit) {
        const removed = events.splice(0, events.length - limit)
        for (const item of removed) seen.delete(item.id)
      }
      return events
    },
    values() { return events.slice() },
    clear() { events.length = 0; seen.clear() },
  }
}

type RuntimeListener = (event: AgentExecutionEvent) => void
const runtimeListeners = new Set<RuntimeListener>()
const runtimeBuffer = createRuntimeEventBuffer()

/** Shared bridge from the existing OpenCode SSE consumer to workspace consumers. */
export function publishRuntimeEvent(event: RuntimeEvent, index = 0, timestamp = Date.now()) {
  const normalized = normalizeRuntimeEvent(event, index, timestamp)
  if (!normalized || runtimeBuffer.push(normalized).length === 0) return normalized
  for (const listener of runtimeListeners) listener(normalized)
  return normalized
}

export function subscribeRuntimeEvents(listener: RuntimeListener) {
  runtimeListeners.add(listener)
  return () => runtimeListeners.delete(listener)
}

export function runtimeEvents() { return runtimeBuffer.values() }

export type WorkspacePreference = { view?: string; expanded?: string[]; contextTab?: string; version: 1 }
export function loadWorkspacePreference(key: string): WorkspacePreference | undefined {
  if (typeof localStorage === "undefined") return undefined
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as WorkspacePreference | null
    return parsed?.version === 1 ? parsed : undefined
  } catch {
    return undefined
  }
}
export function saveWorkspacePreference(key: string, value: WorkspacePreference) {
  if (typeof localStorage === "undefined") return
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* storage is optional */ }
}
