/**
 * Parser for FlowDeck audit log files (.flowdeck/audit.jsonl).
 * Each line is a structured JSON governance event.
 */

export type AuditEvent = {
  timestamp: number
  session: string
  tool: string
  decision: "block" | "warn" | "approve"
  reason?: string
  agent?: string
  depth?: number
}

export type AuditSummary = {
  total: number
  blocked: number
  warned: number
  approved: number
  byTool: Record<string, { blocked: number; warned: number; approved: number }>
  byAgent: Record<string, number>
  delegationViolations: number
  budgetExceedances: number
  recentEvents: AuditEvent[]
}

/**
 * Parse raw JSONL content from .flowdeck/audit.jsonl
 */
export function parseAuditLog(content: string): AuditEvent[] {
  const events: AuditEvent[] = []
  const lines = content.split("\n")

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      events.push({
        timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
        session: typeof parsed.session === "string" ? parsed.session : "",
        tool: typeof parsed.tool === "string" ? parsed.tool : "unknown",
        decision: normalizeDecision(parsed.decision),
        reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
        agent: typeof parsed.agent === "string" ? parsed.agent : undefined,
        depth: typeof parsed.depth === "number" ? parsed.depth : undefined,
      })
    } catch {
      // Skip malformed lines
    }
  }

  return events
}

function normalizeDecision(value: unknown): "block" | "warn" | "approve" {
  if (value === "block" || value === "blocked") return "block"
  if (value === "warn" || value === "warning") return "warn"
  return "approve"
}

/**
 * Summarize audit events into aggregate statistics.
 */
export function summarizeAudit(events: AuditEvent[]): AuditSummary {
  const summary: AuditSummary = {
    total: events.length,
    blocked: 0,
    warned: 0,
    approved: 0,
    byTool: {},
    byAgent: {},
    delegationViolations: 0,
    budgetExceedances: 0,
    recentEvents: events.slice(-20),
  }

  for (const event of events) {
    // Overall counts
    if (event.decision === "block") summary.blocked++
    else if (event.decision === "warn") summary.warned++
    else summary.approved++

    // By tool
    const toolEntry = summary.byTool[event.tool] ?? { blocked: 0, warned: 0, approved: 0 }
    if (event.decision === "block") toolEntry.blocked++
    else if (event.decision === "warn") toolEntry.warned++
    else toolEntry.approved++
    summary.byTool[event.tool] = toolEntry

    // By agent
    if (event.agent) {
      summary.byAgent[event.agent] = (summary.byAgent[event.agent] ?? 0) + 1
    }

    // Delegation violations
    if (event.reason?.includes("delegation") || event.reason?.includes("depth")) {
      summary.delegationViolations++
    }

    // Budget exceedances
    if (event.reason?.includes("budget") || event.reason?.includes("limit")) {
      summary.budgetExceedances++
    }
  }

  return summary
}
