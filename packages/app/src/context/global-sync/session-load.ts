import type { SessionApi } from "@opencode-ai/client/promise"
import { normalizeSessionInfo } from "@/utils/session"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"

export async function loadRootSessions(input: { api: Pick<SessionApi, "list">; directory: string; limit: number }) {
  const result = await input.api.list({
    directory: input.directory,
    parentID: null,
    limit: input.limit,
    order: "desc",
  })
  const dataArray = Array.isArray(result.data) ? result.data : Object.values(result.data ?? {})
  return {
    data: dataArray.map(normalizeSessionInfo),
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
  const dataArray = Array.isArray(result.data) ? result.data : Object.values(result.data ?? {})
  return { data: dataArray.map(normalizeSessionInfo), limit: input.limit, limited: true } as const
}

export function estimateRootSessionTotal(input: { count: number; limit: number; limited: boolean }) {
  if (!input.limited) return input.count
  if (input.count < input.limit) return input.count
  return input.count + 1
}
