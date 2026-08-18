import { describe, expect, test } from "bun:test"
import {
  ApiResponseError,
  normalizeProjectListResponse,
  normalizeSessionListResponse,
} from "./response-normalizers"

describe("OpenCode response normalizers", () => {
  test("normalizes a v2 project response wrapper", () => {
    const result = normalizeProjectListResponse({
      data: [{ id: "project", worktree: "/repo" }] as unknown,
      request: {},
      response: {},
    })

    expect(result as unknown).toEqual([{ id: "project", worktree: "/repo" }])
  })

  test("normalizes a v1 project array", () => {
    expect(normalizeProjectListResponse([{ id: "project", worktree: "/repo" }] as unknown) as unknown).toEqual([
      { id: "project", worktree: "/repo" },
    ])
  })

  test("normalizes a session response wrapper and preserves the cursor", () => {
    const cursor = { next: "cursor" }
    const result = normalizeSessionListResponse({
      data: [{ id: "session", directory: "/repo" }] as unknown,
      cursor,
      request: {},
      response: {},
    })

    expect(result as unknown).toEqual({ data: [{ id: "session", directory: "/repo" }], cursor })
  })

  test("normalizes a legacy session array", () => {
    expect(normalizeSessionListResponse([{ id: "session", directory: "/repo" }] as unknown) as unknown).toEqual({
      data: [{ id: "session", directory: "/repo" }],
    })
  })

  test("rejects malformed project and session responses with structured errors", () => {
    for (const [operation, normalize] of [
      ["project.list", normalizeProjectListResponse],
      ["session.list", normalizeSessionListResponse],
    ] as const) {
      expect(() => normalize({ data: { invalid: true } })).toThrow(ApiResponseError)
      try {
        normalize({ data: { invalid: true } })
      } catch (error) {
        expect(error).toMatchObject({
          code: `${operation.split(".")[0]!.toUpperCase()}_RESPONSE_INVALID`,
          operation,
        })
      }
    }
  })
})
