import type { Part } from "@opencode-ai/sdk/v2/client"

/**
 * FlowDeck tool IDs registered by the plugin (27 tools).
 * Tools prefixed with "fdx-" are matched by prefix; the rest are exact matches.
 */
const FLOWDECK_TOOLS = new Set([
  "doctor",
  "planning-state",
  "codebase-state",
  "repo-memory",
  "hash-edit",
  "codegraph",
  "load-rules",
  "list-rules",
  "capture-lesson",
  "review-lessons",
  "debug-audit",
  "fdx-validate",
  "fdx-worktree",
  "fdx-pr-monitor",
])

const PIPELINE_COMMANDS = ["/fd-task", "/fd-review", "/fd-execute", "/fd-verify", "/fd-done"] as const

export type PipelineStage = "task" | "review" | "execute" | "verify" | "done"

export type FlowdeckSessionStats = {
  sessionID: string
  title: string
  time: { created: number; updated: number }
  toolCalls: Record<string, { total: number; errors: number }>
  agents: Record<string, number>
  tokens: { input: number; output: number; reasoning: number }
  cost: number
  pipelineStages: PipelineStage[]
}

export type AggregatedFlowdeckStats = {
  sessions: FlowdeckSessionStats[]
  totalToolCalls: number
  totalToolErrors: number
  toolBreakdown: Record<string, { total: number; errors: number }>
  agentBreakdown: Record<string, number>
  totalTokens: { input: number; output: number; reasoning: number }
  totalCost: number
  pipelineCompletions: number
  pipelineStarts: number
  stageFrequency: Record<PipelineStage, number>
  governance: {
    blocked: number
    warned: number
    approved: number
  }
  prMonitor: {
    failuresDetected: number
    repairAttempts: number
    repairSuccesses: number
    flakyClassifications: number
  }
}

function isFlowdeckTool(name: string): boolean {
  return name.startsWith("fdx-") || FLOWDECK_TOOLS.has(name)
}

function stageFromCommand(cmd: string): PipelineStage | undefined {
  const map: Record<string, PipelineStage> = {
    "/fd-task": "task",
    "/fd-review": "review",
    "/fd-execute": "execute",
    "/fd-verify": "verify",
    "/fd-done": "done",
  }
  return map[cmd]
}

/**
 * Parse a single session's parts into FlowDeck statistics.
 */
export function parseSessionParts(
  sessionID: string,
  title: string,
  time: { created: number; updated: number },
  parts: Part[],
): FlowdeckSessionStats {
  const toolCalls: Record<string, { total: number; errors: number }> = {}
  const agents: Record<string, number> = {}
  const tokens = { input: 0, output: 0, reasoning: 0 }
  let cost = 0
  const pipelineStages: PipelineStage[] = []

  for (const part of parts) {
    switch (part.type) {
      case "tool": {
        if (!isFlowdeckTool(part.tool)) break
        const entry = toolCalls[part.tool] ?? { total: 0, errors: 0 }
        entry.total++
        if (part.state.status === "error") entry.errors++
        toolCalls[part.tool] = entry

        // Detect pipeline commands from metadata
        const meta = part.metadata
        if (meta && typeof meta.command === "string") {
          const stage = stageFromCommand(meta.command)
          if (stage && !pipelineStages.includes(stage)) pipelineStages.push(stage)
        }
        break
      }
      case "agent": {
        const name = part.name || "unknown"
        agents[name] = (agents[name] ?? 0) + 1
        break
      }
      case "subtask": {
        const agent = part.agent || "unknown"
        agents[agent] = (agents[agent] ?? 0) + 1
        break
      }
      case "step-finish": {
        tokens.input += part.tokens.input
        tokens.output += part.tokens.output
        tokens.reasoning += part.tokens.reasoning
        cost += part.cost
        break
      }
      case "text": {
        // Detect pipeline commands in text content
        const content = part.text
        if (content) {
          for (const cmd of PIPELINE_COMMANDS) {
            if (content.includes(cmd)) {
              const stage = stageFromCommand(cmd)
              if (stage && !pipelineStages.includes(stage)) pipelineStages.push(stage)
            }
          }
        }
        break
      }
    }
  }

  return { sessionID, title, time, toolCalls, agents, tokens, cost, pipelineStages }
}

/**
 * Aggregate multiple session stats into a single summary.
 */
export function aggregateStats(sessions: FlowdeckSessionStats[]): AggregatedFlowdeckStats {
  const toolBreakdown: Record<string, { total: number; errors: number }> = {}
  const agentBreakdown: Record<string, number> = {}
  const totalTokens = { input: 0, output: 0, reasoning: 0 }
  let totalCost = 0
  let totalToolCalls = 0
  let totalToolErrors = 0
  let pipelineCompletions = 0
  let pipelineStarts = 0
  const stageFrequency: Record<PipelineStage, number> = {
    task: 0,
    review: 0,
    execute: 0,
    verify: 0,
    done: 0,
  }

  // Governance and PR monitor stats derived from tool call patterns
  const governance = { blocked: 0, warned: 0, approved: 0 }
  const prMonitor = { failuresDetected: 0, repairAttempts: 0, repairSuccesses: 0, flakyClassifications: 0 }

  for (const session of sessions) {
    // Tool calls
    for (const [tool, counts] of Object.entries(session.toolCalls)) {
      const entry = toolBreakdown[tool] ?? { total: 0, errors: 0 }
      entry.total += counts.total
      entry.errors += counts.errors
      toolBreakdown[tool] = entry
      totalToolCalls += counts.total
      totalToolErrors += counts.errors

      // PR monitor signals
      if (tool === "fdx-pr-monitor") {
        prMonitor.repairAttempts += counts.total
        prMonitor.repairSuccesses += counts.total - counts.errors
        prMonitor.failuresDetected += counts.total
      }
      // Governance signals: debug-audit errors indicate blocks
      if (tool === "debug-audit") {
        governance.blocked += counts.errors
        governance.approved += counts.total - counts.errors
      }
    }

    // Agents
    for (const [agent, count] of Object.entries(session.agents)) {
      agentBreakdown[agent] = (agentBreakdown[agent] ?? 0) + count
    }

    // Tokens and cost
    totalTokens.input += session.tokens.input
    totalTokens.output += session.tokens.output
    totalTokens.reasoning += session.tokens.reasoning
    totalCost += session.cost

    // Pipeline
    if (session.pipelineStages.length > 0) {
      pipelineStarts++
      if (session.pipelineStages.includes("done")) pipelineCompletions++
      for (const stage of session.pipelineStages) {
        stageFrequency[stage]++
      }
    }
  }

  // Governance: total approved is all tool calls minus blocked/warned
  governance.approved = totalToolCalls - governance.blocked - governance.warned

  return {
    sessions,
    totalToolCalls,
    totalToolErrors,
    toolBreakdown,
    agentBreakdown,
    totalTokens,
    totalCost,
    pipelineCompletions,
    pipelineStarts,
    stageFrequency,
    governance,
    prMonitor,
  }
}
