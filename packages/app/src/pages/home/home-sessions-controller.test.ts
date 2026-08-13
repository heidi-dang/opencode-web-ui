import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { buildHomeSessionRecords } from "./home-session-records"

const session = (input: Partial<Session>): Session =>
  ({
    id: "session",
    projectID: "global",
    directory: "/home/heidi",
    title: "Session",
    parentID: undefined,
    time: { created: 1, updated: 2 },
    ...input,
  }) as Session

describe("home session records", () => {
  test("keeps sessions whose project ID is known even when directory is below the project root", () => {
    const project = { id: "global", worktree: "/", expanded: true }
    const records = buildHomeSessionRecords({
      sessions: () => [session({})],
      projectDirectories: () => ["/"],
      projects: () => [project],
      projectByID: () => new Map([["global", project]]),
    })

    expect(records).toHaveLength(1)
    expect(records[0]?.session.id).toBe("session")
  })
})
