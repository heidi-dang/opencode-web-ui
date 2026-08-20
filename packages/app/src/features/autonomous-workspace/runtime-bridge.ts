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
type TimelineDefinition = Pick<AgentExecutionEvent, "kind" | "state" | "timelineLabelKey">
type FallbackIdentityPolicy = {
  domain: (properties: Record<string, unknown>) => string | undefined
  requiresTimestamp?: boolean
}

const timelineDefinitions: Partial<Record<ServerEvent["type"], TimelineDefinition>> = {
  "session.next.tool.called": { kind: "network", state: "active", timelineLabelKey: "autonomousWorkspace.timeline.event.tool" },
  "session.next.tool.progress": { kind: "network", state: "active", timelineLabelKey: "autonomousWorkspace.timeline.event.tool" },
  "session.next.tool.success": { kind: "network", state: "completed", timelineLabelKey: "autonomousWorkspace.timeline.event.tool" },
  "session.next.tool.failed": { kind: "failure", state: "failed", timelineLabelKey: "autonomousWorkspace.timeline.event.tool" },
  "session.next.shell.started": { kind: "shell", state: "active", timelineLabelKey: "autonomousWorkspace.timeline.event.shell" },
  "session.next.shell.ended": { kind: "shell", state: "completed", timelineLabelKey: "autonomousWorkspace.timeline.event.shell" },
  "session.next.step.started": { kind: "reasoning", state: "active", timelineLabelKey: "autonomousWorkspace.timeline.event.step" },
  "session.next.step.ended": { kind: "completion", state: "completed", timelineLabelKey: "autonomousWorkspace.timeline.event.step" },
  "session.next.step.failed": { kind: "failure", state: "failed", timelineLabelKey: "autonomousWorkspace.timeline.event.step" },
  "session.next.retried": { kind: "retry", state: "active", timelineLabelKey: "autonomousWorkspace.timeline.event.retry" },
  "session.next.agent.switched": { kind: "reasoning", state: "completed", timelineLabelKey: "autonomousWorkspace.timeline.event.configuration" },
  "session.next.model.switched": { kind: "reasoning", state: "completed", timelineLabelKey: "autonomousWorkspace.timeline.event.configuration" },
  "permission.asked": { kind: "waiting", state: "active", timelineLabelKey: "autonomousWorkspace.timeline.event.permission" },
  "permission.v2.asked": { kind: "waiting", state: "active", timelineLabelKey: "autonomousWorkspace.timeline.event.permission" },
  "permission.replied": { kind: "waiting", state: "completed", timelineLabelKey: "autonomousWorkspace.timeline.event.permission" },
  "permission.v2.replied": { kind: "waiting", state: "completed", timelineLabelKey: "autonomousWorkspace.timeline.event.permission" },
  "question.asked": { kind: "waiting", state: "active", timelineLabelKey: "autonomousWorkspace.timeline.event.question" },
  "question.v2.asked": { kind: "waiting", state: "active", timelineLabelKey: "autonomousWorkspace.timeline.event.question" },
  "question.replied": { kind: "waiting", state: "completed", timelineLabelKey: "autonomousWorkspace.timeline.event.question" },
  "question.v2.replied": { kind: "waiting", state: "completed", timelineLabelKey: "autonomousWorkspace.timeline.event.question" },
  "question.v2.rejected": { kind: "cancellation", state: "cancelled", timelineLabelKey: "autonomousWorkspace.timeline.event.question" },
  "session.diff": { kind: "edit", state: "completed", timelineLabelKey: "autonomousWorkspace.timeline.event.changes" },
  "session.error": { kind: "failure", state: "failed", timelineLabelKey: "autonomousWorkspace.timeline.event.session" },
  "session.status": { kind: "reasoning", state: "active", timelineLabelKey: "autonomousWorkspace.timeline.event.session" },
  "session.idle": { kind: "completion", state: "completed", timelineLabelKey: "autonomousWorkspace.timeline.event.session" },
}

const fallbackIdentityPolicies: Partial<Record<ServerEvent["type"], FallbackIdentityPolicy>> = {
  "session.next.tool.called": { domain: (properties) => text(properties.callID) },
  "session.next.tool.progress": {
    domain: (properties) => {
      const assistantMessageID = text(properties.assistantMessageID)
      const callID = text(properties.callID)
      return assistantMessageID && callID ? JSON.stringify([assistantMessageID, callID]) : undefined
    },
    requiresTimestamp: true,
  },
  "session.next.tool.success": { domain: (properties) => text(properties.callID) },
  "session.next.tool.failed": { domain: (properties) => text(properties.callID) },
  "session.next.shell.started": { domain: (properties) => text(properties.callID) },
  "session.next.shell.ended": { domain: (properties) => text(properties.callID) },
  "session.next.step.started": { domain: (properties) => text(properties.assistantMessageID) },
  "session.next.step.ended": { domain: (properties) => text(properties.assistantMessageID) },
  "session.next.step.failed": { domain: (properties) => text(properties.assistantMessageID) },
  "session.next.agent.switched": { domain: (properties) => text(properties.messageID) },
  "session.next.model.switched": { domain: (properties) => text(properties.messageID) },
  "permission.asked": { domain: (properties) => text(properties.id) },
  "permission.v2.asked": { domain: (properties) => text(properties.id) },
  "permission.replied": { domain: (properties) => text(properties.requestID) },
  "permission.v2.replied": { domain: (properties) => text(properties.requestID) },
  "question.asked": { domain: (properties) => text(properties.id) },
  "question.v2.asked": { domain: (properties) => text(properties.id) },
  "question.replied": { domain: (properties) => text(properties.requestID) },
  "question.v2.replied": { domain: (properties) => text(properties.requestID) },
  "question.v2.rejected": { domain: (properties) => text(properties.requestID) },
  "session.next.retried": {
    domain: (properties) => number(properties.attempt)?.toString(),
    requiresTimestamp: true,
  },
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

  const policy = fallbackIdentityPolicies[input.event.type]
  const properties = record(input.event.properties)
  const domain = policy && properties ? policy.domain(properties) : undefined
  const at = timestamp(input.event)
  if (!domain || (policy?.requiresTimestamp && at === undefined)) return undefined
  return JSON.stringify([input.serverID, input.directory, input.sessionID, input.event.type, domain, policy?.requiresTimestamp ? at : undefined])
}

function compareEvents(left: AgentExecutionEvent, right: AgentExecutionEvent) {
  return (left.timestamp ?? 0) - (right.timestamp ?? 0) || left.id.localeCompare(right.id)
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
  const properties = record(input.event.properties)
  const sessionStatus = text(record(properties?.status)?.type) ?? text(properties?.status) ?? text(properties?.type)
  const state = input.event.type === "session.status"
    ? sessionStatus === "idle" || sessionStatus === "completed"
      ? "completed"
      : sessionStatus === "error" || sessionStatus === "failed"
        ? "failed"
        : definition.state
    : definition.state
  return {
    id,
    kind: definition.kind,
    timelineLabelKey: definition.timelineLabelKey,
    timestamp: timestamp(input.event),
    state,
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
    reset() {
      if (disposed) return false
      const changed = events.size > 0
      events.clear()
      replayIDs.clear()
      replayOrder.length = 0
      if (changed) notify()
      return changed
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
