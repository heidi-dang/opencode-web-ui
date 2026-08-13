import type { SessionApi, SessionInfo } from "@opencode-ai/client/promise"
import { normalizeSessionInfo } from "@/utils/session"
import type { OpencodeClient, Session } from "@opencode-ai/sdk/v2/client"

function isRecord(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === "object"
}

function isValidSessionInput(item: unknown): item is Session | SessionInfo {
  return isRecord(item) && typeof item.id === "string"
}

function parseSessionData(data: unknown): Session[] {
  const arr = Array.isArray(data) ? data : (typeof data === "object" && data !== null ? Object.values(data) : [])
  return arr.filter(isValidSessionInput).map(normalizeSessionInfo)
}

export async function loadRootSessions(input: { api: Pick<SessionApi, "list">; directory: string; limit: number }) {
  let result
  try {
    result = await input.api.list({
      directory: input.directory,
      parentID: null,
      limit: input.limit,
      order: "desc",
    })
  } catch (firstError) {
    // Transitional v2 servers reject the explicit null root filter. Retry
    // once with the older equivalent query, but preserve the error if both
    // contracts fail so the UI never presents failure as an empty list.
    try {
      result = await input.api.list({ directory: input.directory, limit: input.limit, order: "desc" })
    } catch {
      throw firstError
    }
  }
  return {
    data: parseSessionData(result.data),
    limit: input.limit,
    limited: true,
  } as const
}

export async function loadRootSessionsV1(input: { client: OpencodeClient; directory: string; limit: number }) {
  let result;
  try {
    result = await input.client.session.list({ directory: input.directory, roots: true, limit: input.limit })
  } catch {
    result = await input.client.session.list({ directory: input.directory, roots: true })
  }
  return { data: parseSessionData(result.data), limit: input.limit, limited: true } as const
}

export function estimateRootSessionTotal(input: { count: number; limit: number; limited: boolean }) {
  if (!input.limited) return input.count
  if (input.count < input.limit) return input.count
  return input.count + 1
}
