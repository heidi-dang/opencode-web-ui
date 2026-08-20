import { describe, expect, test } from "bun:test"
import { agentTree, contextUsageFromMessage, normalizeAgentState, normalizeWorkspaceChanges } from "./contracts"
import { normalizeRuntimeEvent, type SessionWorkspaceScope } from "./runtime-bridge"

const workspaceScope: SessionWorkspaceScope = { serverID: "srv-a", directory: "/repo", sessionID: "ses-a" }

describe("autonomous workspace contracts", () => {
  test("normalizes unknown agent states instead of inventing runtime truth", () => {
    expect(normalizeAgentState("stalled")).toBe("unknown")
    expect(normalizeAgentState("working")).toBe("working")
  })

  test("builds a nested agent tree from parent ids", () => {
    const tree = agentTree([
      { id: "root", label: "Root", state: "working" },
      { id: "child", parentId: "root", label: "Child", state: "tool" },
    ])
    expect(tree[0]?.children?.[0]?.id).toBe("child")
  })

  test("keeps unavailable context metrics undefined", () => {
    expect(contextUsageFromMessage(undefined)).toBeUndefined()
  })

  test("filters malformed workspace changes", () => {
    expect(normalizeWorkspaceChanges([{ file: "src/a.ts", status: "modified" }, { status: "modified" }])).toEqual([
      { file: "src/a.ts", status: "modified", additions: undefined, deletions: undefined, patch: undefined },
    ])
  })

  test("preserves the official event identity rather than deriving a display collision key", () => {
    const event = normalizeRuntimeEvent({
      ...workspaceScope,
      event: {
        id: "evt-official",
        type: "session.next.tool.called",
        properties: {
          timestamp: 1,
          sessionID: "ses-a",
          assistantMessageID: "msg-a",
          callID: "tool-a",
          tool: "read",
          input: {},
          provider: { executed: true },
        },
      },
    })

    expect(event?.id).toBe("evt-official")
  })
})
