import type { Message } from "@opencode-ai/sdk/v2"
import type { FileDiffInfo } from "@opencode-ai/client/promise"

export type AgentActivityKind = "reasoning" | "read" | "search" | "edit" | "patch" | "shell" | "test" | "build" | "network" | "mcp" | "waiting" | "retry" | "completion" | "cancellation" | "failure"

export type SessionLineageRelation = "current" | "derived"

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
  label: string
  timestamp: number
  durationMs?: number
  state: "active" | "completed" | "failed" | "cancelled"
  detail?: string
  output?: string
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
    cacheReadTokens: tokens?.cache.read,
    cacheWriteTokens: tokens?.cache.write,
    totalTokens: tokens?.total,
    cost: typeof cost === "number" ? cost : undefined,
  }
}

export function workspaceChangeFromDiff(value: FileDiffInfo): WorkspaceChange {
  return {
    file: value.file,
    status: value.status === "added" || value.status === "deleted" || value.status === "modified" ? value.status : "unknown",
    additions: value.additions,
    deletions: value.deletions,
    patch: value.patch,
  }
}

export function sessionLineageTree(sessions: SessionLineageSnapshot[]) {
  const byParent = new Map<string | undefined, SessionLineageSnapshot[]>()
  for (const session of sessions) byParent.set(session.parentId, [...(byParent.get(session.parentId) ?? []), session])
  const attach = (session: SessionLineageSnapshot): SessionLineageSnapshot => ({
    ...session,
    children: byParent.get(session.id)?.map(attach),
  })
  return (byParent.get(undefined) ?? sessions.filter((session) => !session.parentId)).map(attach)
}
