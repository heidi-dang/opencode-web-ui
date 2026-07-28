/**
 * Parser for FlowDeck STATE.md files and planning artifacts.
 * STATE.md uses YAML-like frontmatter with pipeline stage tracking.
 */

export type PipelineTopic = {
  slug: string
  stage: "task" | "review" | "execute" | "verify" | "done" | "unknown"
  planConfirmed: boolean
  blockers: string[]
  createdAt?: number
  updatedAt?: number
}

export type PipelineSummary = {
  topics: PipelineTopic[]
  totalTopics: number
  completedTopics: number
  activeTopics: number
  blockedTopics: number
  completionRate: number
}

/**
 * Parse a STATE.md file content into a PipelineTopic.
 * Expected format includes YAML frontmatter with fields like:
 *   stage: execute
 *   plan_confirmed: true
 *   blockers: ["..."]
 */
export function parseStateMd(slug: string, content: string): PipelineTopic {
  const topic: PipelineTopic = {
    slug,
    stage: "unknown",
    planConfirmed: false,
    blockers: [],
  }

  // Extract YAML-like key: value pairs
  const stageMatch = content.match(/^stage:\s*(.+)$/m)
  if (stageMatch) {
    const stage = stageMatch[1].trim().toLowerCase()
    if (["task", "review", "execute", "verify", "done"].includes(stage)) {
      topic.stage = stage as PipelineTopic["stage"]
    }
  }

  const confirmedMatch = content.match(/^plan_confirmed:\s*(true|false)$/m)
  if (confirmedMatch) {
    topic.planConfirmed = confirmedMatch[1] === "true"
  }

  // Parse blockers array
  const blockersMatch = content.match(/^blockers:\s*\[([^\]]*)\]/m)
  if (blockersMatch && blockersMatch[1]) {
    topic.blockers = blockersMatch[1]
      .split(",")
      .map((b) => b.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean)
  }

  // Timestamps
  const createdMatch = content.match(/^created:\s*(\d+)$/m)
  if (createdMatch) topic.createdAt = parseInt(createdMatch[1], 10)

  const updatedMatch = content.match(/^updated:\s*(\d+)$/m)
  if (updatedMatch) topic.updatedAt = parseInt(updatedMatch[1], 10)

  return topic
}

/**
 * Summarize multiple pipeline topics.
 */
export function summarizePipeline(topics: PipelineTopic[]): PipelineSummary {
  const completedTopics = topics.filter((t) => t.stage === "done").length
  const blockedTopics = topics.filter((t) => t.blockers.length > 0).length
  const activeTopics = topics.filter((t) => t.stage !== "done" && t.stage !== "unknown").length

  return {
    topics,
    totalTopics: topics.length,
    completedTopics,
    activeTopics,
    blockedTopics,
    completionRate: topics.length > 0 ? completedTopics / topics.length : 0,
  }
}

/**
 * Parse a FlowDeck scorecard JSON file.
 */
export type Scorecard = {
  sessionID: string
  agent: string
  duration: number
  toolCalls: number
  tokensUsed: number
  outcome: "success" | "partial" | "failure"
  timestamp: number
}

export function parseScorecard(content: string): Scorecard | undefined {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    return {
      sessionID: typeof parsed.sessionID === "string" ? parsed.sessionID : "",
      agent: typeof parsed.agent === "string" ? parsed.agent : "unknown",
      duration: typeof parsed.duration === "number" ? parsed.duration : 0,
      toolCalls: typeof parsed.toolCalls === "number" ? parsed.toolCalls : 0,
      tokensUsed: typeof parsed.tokensUsed === "number" ? parsed.tokensUsed : 0,
      outcome: normalizeOutcome(parsed.outcome),
      timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
    }
  } catch {
    return undefined
  }
}

function normalizeOutcome(value: unknown): "success" | "partial" | "failure" {
  if (value === "success") return "success"
  if (value === "partial") return "partial"
  return "failure"
}
