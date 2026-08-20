import { describe, expect, test } from "bun:test"
import type { Message } from "@opencode-ai/sdk/v2"
import {
  contextUsageFromMessage,
  normalizeWorkspaceChanges,
  sessionLineageTree,
  type SessionLineageSnapshot,
  type ContextUsageSnapshot,
} from "./contracts"
import { normalizeRuntimeEvent, type SessionWorkspaceScope } from "./runtime-bridge"

const workspaceScope: SessionWorkspaceScope = { serverID: "srv-a", directory: "/repo", sessionID: "ses-a" }
type KeysAbsent<T, Keys extends PropertyKey> = Extract<keyof T, Keys> extends never ? true : false
const lineageExcludesFabricatedRuntimeFields: KeysAbsent<
  SessionLineageSnapshot,
  "task" | "progress" | "currentTool" | "elapsedMs"
> = true
const usageExcludesFabricatedContextFields: KeysAbsent<ContextUsageSnapshot, "contextUsed" | "contextLimit"> = true

describe("autonomous workspace contracts", () => {
  test("excludes fabricated lineage and context fields from the presentation boundary", () => {
    expect(lineageExcludesFabricatedRuntimeFields).toBe(true)
    expect(usageExcludesFabricatedContextFields).toBe(true)
  })

  test("builds derived session lineage without agent task or progress semantics", () => {
    const snapshots: SessionLineageSnapshot[] = [
      { id: "root", label: "Root session", relation: "current" },
      { id: "child", parentId: "root", label: "Child session", relation: "derived" },
    ]
    const tree = sessionLineageTree(snapshots)

    expect(tree[0]?.children?.[0]?.id).toBe("child")
    expect(tree[0]?.children?.[0]?.relation).toBe("derived")
  })

  test("keeps unavailable context metrics undefined", () => {
    expect(contextUsageFromMessage(undefined)).toBeUndefined()
  })

  test("projects only authoritative model provider token and cost metadata", () => {
    const message = {
      id: "msg-a",
      sessionID: "ses-a",
      role: "assistant",
      time: { created: 1 },
      parentID: "msg-user",
      modelID: "model-a",
      providerID: "provider-a",
      mode: "build",
      agent: "build",
      path: { cwd: "/repo", root: "/repo" },
      cost: 0.25,
      tokens: {
        input: 100,
        output: 50,
        reasoning: 20,
        cache: { read: 10, write: 5 },
      },
    } satisfies Message

    expect(contextUsageFromMessage(message)).toEqual({
      model: { providerID: "provider-a", modelID: "model-a" },
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 20,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      totalTokens: undefined,
      cost: 0.25,
    })
  })

  test("filters malformed workspace changes", () => {
    expect(normalizeWorkspaceChanges([{ file: "src/a.ts", status: "modified" }, { status: "modified" }])).toEqual([
      { file: "src/a.ts", status: "modified", additions: undefined, deletions: undefined, patch: undefined },
    ])
  })

  test("preserves renamed and unsupported changes without inventing a patch", () => {
    expect(
      normalizeWorkspaceChanges([
        { file: "src/new.ts", status: "renamed" },
        { file: "public/asset.bin", status: "modified", binary: true, patch: "not-a-real-diff" },
      ]),
    ).toEqual([
      {
        file: "src/new.ts",
        status: "renamed",
        additions: undefined,
        deletions: undefined,
        patch: undefined,
      },
      {
        file: "public/asset.bin",
        status: "unsupported",
        additions: undefined,
        deletions: undefined,
        patch: undefined,
      },
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
