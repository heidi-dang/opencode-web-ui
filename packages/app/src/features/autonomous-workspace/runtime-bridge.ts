import type { ServerEvent } from "@/context/server-sdk"
import type { AgentExecutionEvent } from "./contracts"

type WithoutID<T> = T extends { id: string } ? Omit<T, "id"> & { id?: undefined } : never

/** Compatibility shape for an upstream event that genuinely lacks its official identifier. */
export type IdlessServerEvent = WithoutID<ServerEvent>

export type SessionWorkspaceScope = {
  serverID: string
  directory: string
  sessionID: string
}

export type SessionWorkspaceEventInput = SessionWorkspaceScope & {
  event: ServerEvent | IdlessServerEvent
}

type SessionWorkspaceListener = () => void
type TimelineDefinition = Pick<AgentExecutionEvent, "kind" | "state">

const timelineDefinitions: Partial<Record<ServerEvent["type"], TimelineDefinition>> = {
  "session.next.tool.called": { kind: "network", state: "active" },
  "session.next.tool.progress": { kind: "network", state: "active" },
  "session.next.tool.success": { kind: "network", state: "completed" },
  "session.next.tool.failed": { kind: "failure", state: "failed" },
  "session.next.shell.started": { kind: "shell", state: "active" },
  "session.next.shell.ended": { kind: "shell", state: "completed" },
  "session.next.step.started": { kind: "reasoning", state: "active" },
  "session.next.step.ended": { kind: "completion", state: "completed" },
  "session.next.step.failed": { kind: "failure", state: "failed" },
  "session.next.retried": { kind: "retry", state: "active" },
  "session.next.agent.switched": { kind: "reasoning", state: "completed" },
  "session.next.model.switched": { kind: "reasoning", state: "completed" },
  "permission.asked": { kind: "waiting", state: "active" },
  "permission.v2.asked": { kind: "waiting", state: "active" },
  "permission.replied": { kind: "waiting", state: "completed" },
  "permission.v2.replied": { kind: "waiting", state: "completed" },
  "question.asked": { kind: "waiting", state: "active" },
  "question.v2.asked": { kind: "waiting", state: "active" },
  "question.replied": { kind: "waiting", state: "completed" },
  "question.v2.replied": { kind: "waiting", state: "completed" },
  "question.v2.rejected": { kind: "cancellation", state: "cancelled" },
  "session.diff": { kind: "edit", state: "completed" },
  "session.error": { kind: "failure", state: "failed" },
  "session.status": { kind: "reasoning", state: "active" },
  "session.idle": { kind: "completion", state: "completed" },
}

const text = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : undefined)
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function sessionID(event: ServerEvent | IdlessServerEvent) {
  const properties = record(event.properties)
  return text(properties?.sessionID) ?? text(properties?.sessionId)
}

function timestamp(event: ServerEvent | IdlessServerEvent) {
  const properties = record(event.properties)
  return number(properties?.timestamp) ?? number(properties?.time)
}

function domainID(event: ServerEvent | IdlessServerEvent) {
  const properties = record(event.properties)
  return text(properties?.callID)
    ?? text(properties?.partID)
    ?? text(properties?.messageID)
    ?? text(properties?.assistantMessageID)
    ?? text(properties?.requestID)
    ?? text(properties?.id)
    ?? number(properties?.attempt)?.toString()
}

function validScope(value: unknown): value is SessionWorkspaceScope {
  const source = record(value)
  return !!source && !!text(source.serverID) && !!text(source.directory) && !!text(source.sessionID)
}

function sameScope(left: SessionWorkspaceScope, right: SessionWorkspaceScope) {
  return left.serverID === right.serverID && left.directory === right.directory && left.sessionID === right.sessionID
}

function identity(input: SessionWorkspaceEventInput) {
  const officialID = text(input.event.id)
  if (officialID) return officialID

  const at = timestamp(input.event)
  const domain = domainID(input.event)
  if (at === undefined || !domain) return undefined
  return JSON.stringify([input.serverID, input.directory, input.sessionID, input.event.type, domain, at])
}

function compareEvents(left: AgentExecutionEvent, right: AgentExecutionEvent) {
  return left.timestamp - right.timestamp || left.id.localeCompare(right.id)
}

function boundedLimit(value: number | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback
}

/**
 * Maps only explicit, safe official event metadata into a transient workspace timeline.
 * Message content, prompts, deltas, tool payloads, command output, file content, and errors
 * remain in their existing authoritative stores and are intentionally not copied here.
 */
export function normalizeRuntimeEvent(input: SessionWorkspaceEventInput): AgentExecutionEvent | undefined {
  if (!validScope(input) || sessionID(input.event) !== input.sessionID) return undefined
  const definition = timelineDefinitions[input.event.type]
  const id = identity(input)
  if (!definition || !id) return undefined
  return {
    id,
    kind: definition.kind,
    label: input.event.type,
    timestamp: timestamp(input.event) ?? 0,
    state: definition.state,
  }
}

/**
 * Holds only transient presentation events for one active session route.
 * Authoritative session state continues to live in the existing reducers.
 */
export function createSessionWorkspaceController(
  scope: SessionWorkspaceScope,
  options: { limit?: number; replayLimit?: number } = {},
) {
  const limit = boundedLimit(options.limit, 500)
  const replayLimit = Math.max(limit, boundedLimit(options.replayLimit, Math.max(100, limit * 4)))
  const events = new Map<string, AgentExecutionEvent>()
  const replayIDs = new Set<string>()
  const replayOrder: string[] = []
  const listeners = new Set<SessionWorkspaceListener>()
  let disposed = false

  const timeline = () => [...events.values()].sort(compareEvents)

  const rememberReplayID = (id: string) => {
    replayIDs.add(id)
    replayOrder.push(id)
    while (replayOrder.length > replayLimit) {
      const candidate = replayOrder.shift()
      if (!candidate || !replayIDs.has(candidate)) continue
      if (events.has(candidate) && replayOrder.some((item) => !events.has(item))) {
        replayOrder.push(candidate)
        continue
      }
      replayIDs.delete(candidate)
    }
  }

  const notify = () => {
    for (const listener of listeners) listener()
  }

  return {
    accept(input: SessionWorkspaceEventInput) {
      if (disposed || !validScope(input) || !sameScope(input, scope)) return false
      const normalized = normalizeRuntimeEvent(input)
      if (!normalized || replayIDs.has(normalized.id)) return false

      const before = timeline().map((item) => item.id)
      rememberReplayID(normalized.id)
      events.set(normalized.id, normalized)
      const overflow = timeline().slice(0, Math.max(0, events.size - limit))
      for (const item of overflow) events.delete(item.id)
      const after = timeline().map((item) => item.id)
      if (before.length === after.length && before.every((id, index) => id === after[index])) return false

      notify()
      return true
    },
    timeline,
    subscribe(listener: SessionWorkspaceListener) {
      if (disposed) return () => {}
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose() {
      if (disposed) return
      disposed = true
      events.clear()
      replayIDs.clear()
      replayOrder.length = 0
      listeners.clear()
    },
  }
}

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
