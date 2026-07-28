import { useQuery } from "@tanstack/solid-query"
import { createMemo } from "solid-js"
import type { Part, Session } from "@opencode-ai/sdk/v2/client"
import { useServerSDK } from "@/context/server-sdk"
import { aggregateStats, parseSessionParts, type AggregatedFlowdeckStats, type FlowdeckSessionStats } from "./parsers/session-parser"
import type { AuditSummary } from "./parsers/audit-parser"
import type { PipelineSummary } from "./parsers/pipeline-parser"

const SESSION_LIMIT = 50

type FlowdeckData = {
  stats: AggregatedFlowdeckStats
  audit?: AuditSummary
  pipeline?: PipelineSummary
  hasFlowdeckActivity: boolean
}

/**
 * Fetch sessions and their message parts, then parse FlowDeck signals.
 */
async function fetchFlowdeckData(
  client: { session: { list: Function; messages?: Function } },
  directory?: string,
): Promise<FlowdeckSessionStats[]> {
  // Fetch sessions
  const sessionRes = await client.session.list({ directory, limit: SESSION_LIMIT })
  const sessions: Session[] = (sessionRes.data as { items?: Session[] })?.items ?? (sessionRes.data as Session[]) ?? []

  if (!Array.isArray(sessions) || sessions.length === 0) return []

  const results: FlowdeckSessionStats[] = []

  // Fetch messages for each session (batched)
  for (const session of sessions) {
    try {
      const msgRes = await (client.session as any).messages({
        sessionID: session.id,
        directory,
        limit: 200,
      })
      const messages = (msgRes.data as { items?: any[] })?.items ?? (msgRes.data as any[]) ?? []

      // Collect all parts from all messages
      const parts: Part[] = []
      for (const msg of messages) {
        if (msg.parts && Array.isArray(msg.parts)) {
          parts.push(...msg.parts)
        }
      }

      if (parts.length > 0) {
        const stats = parseSessionParts(session.id, session.title, session.time, parts)
        // Only include sessions that have FlowDeck activity
        if (
          Object.keys(stats.toolCalls).length > 0 ||
          Object.keys(stats.agents).length > 0 ||
          stats.pipelineStages.length > 0
        ) {
          results.push(stats)
        }
      }
    } catch {
      // Skip sessions that fail to load
    }
  }

  return results
}

/**
 * Main hook: aggregates FlowDeck statistics across all sessions.
 */
export function useFlowdeckStats() {
  const serverSDK = useServerSDK()

  const query = useQuery(() => ({
    queryKey: ["flowdeck-stats", serverSDK().url],
    queryFn: async (): Promise<FlowdeckData> => {
      const sdk = serverSDK()
      const client = sdk.client as any

      const sessionStats = await fetchFlowdeckData(client)
      const stats = aggregateStats(sessionStats)

      return {
        stats,
        audit: undefined, // File-based audit data requires filesystem access
        pipeline: undefined, // File-based pipeline data requires filesystem access
        hasFlowdeckActivity: sessionStats.length > 0,
      }
    },
    staleTime: 60_000, // Cache for 1 minute
    retry: 1,
  }))

  const data = createMemo(() => query.data)
  const isLoading = createMemo(() => query.isLoading)
  const isError = createMemo(() => query.isError)
  const refetch = () => query.refetch()

  return { data, isLoading, isError, refetch }
}
