import type { Message } from "@opencode-ai/sdk/v2"
import type { FileDiffInfo } from "@opencode-ai/client/promise"

export type AgentExecutionState = "idle" | "thinking" | "working" | "tool" | "waiting" | "completed" | "failed" | "cancelled" | "unknown"
export type AgentActivityKind = "reasoning" | "read" | "search" | "edit" | "patch" | "shell" | "test" | "build" | "network" | "mcp" | "delegation" | "waiting" | "retry" | "completion" | "cancellation" | "failure"

export interface AgentRuntimeSnapshot {
  id: string
  parentId?: string
  label: string
  task?: string
  model?: { providerID?: string; modelID?: string }
  state: AgentExecutionState
  activity?: string
  currentTool?: string
  currentFile?: string
  elapsedMs?: number
  progress?: number
  updatedAt?: number
  children?: AgentRuntimeSnapshot[]
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
  totalTokens?: number
  contextUsed?: number
  contextLimit?: number
  cost?: number
  updatedAt?: number
}

export interface WorkspaceChange {
  file: string
  status: "added" | "modified" | "deleted" | "renamed" | "unknown"
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

export function normalizeAgentState(value: unknown): AgentExecutionState {
  if (value === "idle" || value === "thinking" || value === "working" || value === "tool" || value === "waiting" || value === "completed" || value === "failed" || value === "cancelled") return value
  return "unknown"
}

export function normalizeWorkspaceChanges(value: unknown): WorkspaceChange[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    if (typeof record.file !== "string") return []
    const status = record.status
    return [{
      file: record.file,
      status: status === "added" || status === "modified" || status === "deleted" || status === "renamed" ? status : "unknown",
      additions: typeof record.additions === "number" ? record.additions : undefined,
      deletions: typeof record.deletions === "number" ? record.deletions : undefined,
      patch: typeof record.patch === "string" ? record.patch : undefined,
    }]
  })
}

export function contextUsageFromMessage(message: Message | undefined): ContextUsageSnapshot | undefined {
  if (!message || message.role !== "assistant") return undefined
  const tokens = message.tokens
  const cost = message.cost
  if (!tokens && typeof cost !== "number") return undefined
  return {
    inputTokens: tokens?.input,
    outputTokens: tokens?.output,
    totalTokens: tokens ? tokens.input + tokens.output + (tokens.reasoning ?? 0) + (tokens.cache?.read ?? 0) : undefined,
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

export function agentTree(agents: AgentRuntimeSnapshot[]) {
  const byParent = new Map<string | undefined, AgentRuntimeSnapshot[]>()
  for (const agent of agents) byParent.set(agent.parentId, [...(byParent.get(agent.parentId) ?? []), agent])
  const attach = (agent: AgentRuntimeSnapshot): AgentRuntimeSnapshot => ({ ...agent, children: byParent.get(agent.id)?.map(attach) })
  return (byParent.get(undefined) ?? agents.filter((agent) => !agent.parentId)).map(attach)
}
