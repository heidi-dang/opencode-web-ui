import type { Project, Session } from "@opencode-ai/sdk/v2/client"

export class ApiResponseError extends Error {
  readonly code: string
  readonly operation: string

  constructor(operation: string) {
    super(`Invalid response from ${operation}`)
    this.name = "ApiResponseError"
    this.code = `${operation.split(".")[0]!.toUpperCase()}_RESPONSE_INVALID`
    this.operation = operation
  }
}

type ResponseWrapper = {
  data?: unknown
  cursor?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function responseData(value: unknown, operation: string): { data: unknown[]; cursor?: unknown } {
  if (Array.isArray(value)) return { data: value }
  if (!isRecord(value)) throw new ApiResponseError(operation)

  const wrapper = value as ResponseWrapper
  if (!Array.isArray(wrapper.data)) throw new ApiResponseError(operation)
  return { data: wrapper.data, cursor: wrapper.cursor }
}

export function normalizeProjectListResponse(value: unknown): Project[] {
  return responseData(value, "project.list").data as Project[]
}

export type NormalizedSessionListResponse = {
  data: Session[]
  cursor?: unknown
}

export function normalizeSessionListResponse(value: unknown): NormalizedSessionListResponse {
  const result = responseData(value, "session.list")
  return { data: result.data as Session[], cursor: result.cursor }
}

export function normalizeArrayResponse<T>(value: unknown, operation: string): T[] {
  return responseData(value, operation).data as T[]
}
