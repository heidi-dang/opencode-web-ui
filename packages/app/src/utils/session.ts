import type { SessionApi, SessionInfo, SessionListInput } from "@opencode-ai/client/promise"
import type { Session } from "@opencode-ai/sdk/v2/client"

export function normalizeSessionInfo(input: SessionInfo | Session): Session {
  if (!("location" in input)) return input
  return {
    id: input.id,
    slug: input.id,
    projectID: input.projectID,
    workspaceID: input.location.workspaceID,
    directory: input.location.directory,
    path: input.subpath,
    parentID: input.parentID,
    cost: input.cost,
    tokens: input.tokens,
    title: input.title,
    agent: input.agent,
    model: input.model,
    version: "",
    time: input.time,
    revert: input.revert && {
      messageID: input.revert.messageID,
      partID: input.revert.partID,
      snapshot: input.revert.snapshot,
    },
  }
}

/**
 * Normalise an unknown session-list payload (array or keyed record) into a
 * typed Session array. The underlying API clients return loosely-typed data,
 * so normalise at the boundary instead of in callers.
 */
export function normalizeSessionList(data: unknown): Session[] {
  if (data == null) return []
  const items = Array.isArray(data) ? data : Object.values(data as Record<string, unknown>)
  return items.map((item) => normalizeSessionInfo(item as SessionInfo | Session))
}

export async function listAllSessions(api: Pick<SessionApi, "list">, input: Omit<SessionListInput, "cursor">) {
  const load = async (cursor?: string): Promise<Session[]> => {
    const result = await api.list({ ...input, limit: input.limit ?? 100, cursor })
    const sessions = result.data.map(normalizeSessionInfo)
    if (result.data.length === 0 || !result.cursor.next) return sessions
    return [...sessions, ...(await load(result.cursor.next))]
  }
  return load()
}
