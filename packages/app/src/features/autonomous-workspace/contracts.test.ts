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

  test("retains a session with a missing parent as an unavailable root", () => {
    const tree = sessionLineageTree([
      { id: "root", label: "Root session", relation: "current" },
      { id: "orphan", parentId: "missing", label: "Orphan session", relation: "derived" },
    ])

    expect(tree.map((session) => [session.id, session.relation])).toEqual([
      ["root", "current"],
      ["orphan", "unavailable"],
    ])
  })

  test("turns cyclic lineage into stable unavailable roots without recursing", () => {
    const tree = sessionLineageTree([
      { id: "a", parentId: "b", label: "Session A", relation: "derived" },
      { id: "b", parentId: "a", label: "Session B", relation: "derived" },
      { id: "child", parentId: "a", label: "Child", relation: "derived" },
    ])

    expect(tree.map((session) => [session.id, session.relation, session.children?.map((child) => child.id) ?? []])).toEqual([
      ["a", "unavailable", []],
      ["b", "unavailable", []],
      ["child", "unavailable", []],
    ])
  })

  test("uses the first duplicate session deterministically and marks its lineage unavailable", () => {
    const tree = sessionLineageTree([
      { id: "duplicate", label: "First", relation: "current" },
      { id: "duplicate", label: "Second", relation: "derived" },
      { id: "child", parentId: "duplicate", label: "Child", relation: "derived" },
      { id: "last", label: "Last", relation: "current" },
    ])

    expect(tree.map((session) => [session.id, session.label, session.relation, session.children?.map((child) => child.id) ?? []])).toEqual([
      ["duplicate", "First", "unavailable", ["child"]],
      ["last", "Last", "current", []],
    ])
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

  test("maps allowlisted runtime events to safe localized label keys without display payloads", () => {
    const event = normalizeRuntimeEvent({
      ...workspaceScope,
      event: {
        id: "evt-tool",
        type: "session.next.tool.called",
        properties: {
          timestamp: 1,
          sessionID: "ses-a",
          assistantMessageID: "msg-a",
          callID: "tool-a",
          tool: "read",
          input: { secret: "must-not-render" },
          provider: { executed: true },
        },
      },
    })

    expect(event).toEqual({
      id: "evt-tool",
      kind: "network",
      timelineLabelKey: "autonomousWorkspace.timeline.event.tool",
      timestamp: 1,
      state: "active",
    })
    expect(event).not.toHaveProperty("label")
    expect(event).not.toHaveProperty("detail")
    expect(event).not.toHaveProperty("output")
  })

  test("maps idle session status to completed and does not invent a timestamp", () => {
    const event = normalizeRuntimeEvent({
      ...workspaceScope,
      event: {
        id: "evt-status",
        type: "session.status",
        properties: { sessionID: "ses-a", status: { type: "idle" } },
      },
    })

    expect(event?.state).toBe("completed")
    expect(event?.timestamp).toBeUndefined()
  })
})
