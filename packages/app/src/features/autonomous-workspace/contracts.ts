import type { Message } from "@opencode-ai/sdk/v2"
type WorkspaceDiffLike = {
  file: string
  status?: string
  additions?: number
  deletions?: number
  patch?: string
  binary?: boolean
}

export type AgentActivityKind = "reasoning" | "read" | "search" | "edit" | "patch" | "shell" | "test" | "build" | "network" | "mcp" | "waiting" | "retry" | "completion" | "cancellation" | "failure"

export type SessionLineageRelation = "current" | "derived" | "unavailable"

export type TimelineLabelKey =
  | "autonomousWorkspace.timeline.event.tool"
  | "autonomousWorkspace.timeline.event.shell"
  | "autonomousWorkspace.timeline.event.step"
  | "autonomousWorkspace.timeline.event.retry"
  | "autonomousWorkspace.timeline.event.configuration"
  | "autonomousWorkspace.timeline.event.permission"
  | "autonomousWorkspace.timeline.event.question"
  | "autonomousWorkspace.timeline.event.changes"
  | "autonomousWorkspace.timeline.event.session"

export interface SessionLineageSnapshot {
  id: string
  parentId?: string
  label: string
  relation: SessionLineageRelation
  model?: { providerID?: string; modelID?: string }
  children?: SessionLineageSnapshot[]
}

export interface AgentExecutionEvent {
  id: string
  agentId?: string
  kind: AgentActivityKind
  timelineLabelKey: TimelineLabelKey
  timestamp?: number
  durationMs?: number
  state: "active" | "completed" | "failed" | "cancelled"
}

export interface ContextUsageSnapshot {
  model?: { providerID?: string; modelID?: string }
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  totalTokens?: number
  cost?: number
}

export interface WorkspaceChange {
  file: string
  status: "added" | "modified" | "deleted" | "renamed" | "unsupported" | "unknown"
  additions?: number
  deletions?: number
  patch?: string
  agentId?: string
  sessionId?: string
}

export interface RuntimeHealthSnapshot {
  state: "connected" | "connecting" | "degraded" | "disconnected" | "unknown"
  detail?: string
  updatedAt?: number
}

export function normalizeWorkspaceChanges(value: unknown): WorkspaceChange[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    if (typeof record.file !== "string") return []
    const status = record.status
    const unsupported = record.binary === true || status === "unsupported"
    return [{
      file: record.file,
      status: unsupported
        ? "unsupported"
        : status === "added" || status === "modified" || status === "deleted" || status === "renamed"
          ? status
          : "unknown",
      additions: typeof record.additions === "number" ? record.additions : undefined,
      deletions: typeof record.deletions === "number" ? record.deletions : undefined,
      patch: !unsupported && typeof record.patch === "string" ? record.patch : undefined,
    }]
  })
}

export function contextUsageFromMessage(message: Message | undefined): ContextUsageSnapshot | undefined {
  if (!message || message.role !== "assistant") return undefined
  const tokens = message.tokens
  const cost = message.cost
  if (!tokens && typeof cost !== "number") return undefined
  return {
    model: { providerID: message.providerID, modelID: message.modelID },
    inputTokens: tokens?.input,
    outputTokens: tokens?.output,
    reasoningTokens: tokens?.reasoning,
    cacheReadTokens: tokens?.cache?.read,
    cacheWriteTokens: tokens?.cache?.write,
    totalTokens: tokens?.total,
    cost: typeof cost === "number" ? cost : undefined,
  }
}

export function workspaceChangeFromDiff(value: WorkspaceDiffLike): WorkspaceChange {
  const status = value.status
  const unsupported = value.binary === true
  return {
    file: value.file,
    status: unsupported
      ? "unsupported"
      : status === "added" || status === "deleted" || status === "modified" || status === "renamed"
        ? status
        : "unknown",
    additions: unsupported ? undefined : value.additions,
    deletions: unsupported ? undefined : value.deletions,
    patch: unsupported ? undefined : value.patch,
  }
}

export function sessionLineageTree(sessions: SessionLineageSnapshot[]) {
  const duplicateIDs = new Set<string>()
  const byID = new Map<string, SessionLineageSnapshot>()
  const ordered: SessionLineageSnapshot[] = []
  for (const session of sessions) {
    if (byID.has(session.id)) {
      duplicateIDs.add(session.id)
      continue
    }
    const next = { ...session, children: undefined }
    byID.set(session.id, next)
    ordered.push(next)
  }

  const cycleIDs = new Set<string>()
  const states = new Map<string, "visiting" | "visited">()
  const stack: string[] = []
  const visit = (id: string) => {
    if (states.get(id) === "visited") return
    if (states.get(id) === "visiting") {
      const start = stack.lastIndexOf(id)
      for (const item of stack.slice(Math.max(0, start))) cycleIDs.add(item)
      return
    }
    states.set(id, "visiting")
    stack.push(id)
    const parentID = byID.get(id)?.parentId
    if (parentID && byID.has(parentID)) visit(parentID)
    stack.pop()
    states.set(id, "visited")
  }
  for (const session of ordered) visit(session.id)

  const invalidIDs = new Set(cycleIDs)
  for (const session of ordered) {
    if (session.parentId && invalidIDs.has(session.parentId)) invalidIDs.add(session.id)
  }

  const children = new Map<string, SessionLineageSnapshot[]>()
  const roots: SessionLineageSnapshot[] = []
  for (const session of ordered) {
    const unresolved = duplicateIDs.has(session.id) || invalidIDs.has(session.id) || (!!session.parentId && !byID.has(session.parentId))
    if (unresolved) session.relation = "unavailable"
    if (!session.parentId || unresolved) {
      roots.push(session)
      continue
    }
    children.set(session.parentId, [...(children.get(session.parentId) ?? []), session])
  }

  const attach = (session: SessionLineageSnapshot): SessionLineageSnapshot => ({
    ...session,
    children: (children.get(session.id) ?? []).map(attach),
  })
  return roots.map(attach)
}
