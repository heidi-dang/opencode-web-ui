import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { parseSessionParts, aggregateStats } from "./session-parser"

const toolPart = (tool: string, status: "completed" | "error" = "completed"): Part =>
  ({
    id: `part-${Math.random()}`,
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool",
    callID: `call-${Math.random()}`,
    tool,
    state: { status, input: {} },
  }) as Part

const agentPart = (name: string): Part =>
  ({
    id: `part-${Math.random()}`,
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "agent",
    name,
  }) as Part

const subtaskPart = (agent: string): Part =>
  ({
    id: `part-${Math.random()}`,
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "subtask",
    prompt: "do something",
    description: "test",
    agent,
  }) as Part

const stepFinishPart = (input: number, output: number, reasoning: number, cost: number): Part =>
  ({
    id: `part-${Math.random()}`,
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "step-finish",
    reason: "end_turn",
    cost,
    tokens: { input, output, reasoning, cache: { read: 0, write: 0 } },
  }) as Part

const textPart = (text: string): Part =>
  ({
    id: `part-${Math.random()}`,
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "text",
    text,
  }) as Part

describe("parseSessionParts", () => {
  test("counts FlowDeck tool calls and ignores non-FlowDeck tools", () => {
    const parts = [
      toolPart("fdx-read"),
      toolPart("fdx-search"),
      toolPart("fdx-read", "error"),
      toolPart("bash"), // not a FlowDeck tool
      toolPart("planning-state"),
    ]

    const stats = parseSessionParts("ses_1", "Test", { created: 1000, updated: 2000 }, parts)

    expect(stats.toolCalls["fdx-read"]).toEqual({ total: 2, errors: 1 })
    expect(stats.toolCalls["fdx-search"]).toEqual({ total: 1, errors: 0 })
    expect(stats.toolCalls["planning-state"]).toEqual({ total: 1, errors: 0 })
    expect(stats.toolCalls["bash"]).toBeUndefined()
  })

  test("tracks agent delegations from agent parts", () => {
    const parts = [agentPart("heidi"), agentPart("backend-coder"), agentPart("heidi")]

    const stats = parseSessionParts("ses_1", "Test", { created: 1000, updated: 2000 }, parts)

    expect(stats.agents["heidi"]).toBe(2)
    expect(stats.agents["backend-coder"]).toBe(1)
  })

  test("tracks agent delegations from subtask parts", () => {
    const parts = [subtaskPart("tester"), subtaskPart("reviewer")]

    const stats = parseSessionParts("ses_1", "Test", { created: 1000, updated: 2000 }, parts)

    expect(stats.agents["tester"]).toBe(1)
    expect(stats.agents["reviewer"]).toBe(1)
  })

  test("sums tokens and cost from step-finish parts", () => {
    const parts = [
      stepFinishPart(100, 50, 20, 0.001),
      stepFinishPart(200, 100, 30, 0.002),
    ]

    const stats = parseSessionParts("ses_1", "Test", { created: 1000, updated: 2000 }, parts)

    expect(stats.tokens.input).toBe(300)
    expect(stats.tokens.output).toBe(150)
    expect(stats.tokens.reasoning).toBe(50)
    expect(stats.cost).toBeCloseTo(0.003)
  })

  test("detects pipeline stages from text content", () => {
    const parts = [
      textPart("Running /fd-task to define requirements"),
      textPart("Now executing /fd-execute for implementation"),
    ]

    const stats = parseSessionParts("ses_1", "Test", { created: 1000, updated: 2000 }, parts)

    expect(stats.pipelineStages).toContain("task")
    expect(stats.pipelineStages).toContain("execute")
    expect(stats.pipelineStages).not.toContain("done")
  })

  test("returns empty stats for sessions with no FlowDeck activity", () => {
    const parts = [toolPart("bash"), toolPart("read"), textPart("hello world")]

    const stats = parseSessionParts("ses_1", "Test", { created: 1000, updated: 2000 }, parts)

    expect(Object.keys(stats.toolCalls)).toHaveLength(0)
    expect(Object.keys(stats.agents)).toHaveLength(0)
    expect(stats.pipelineStages).toHaveLength(0)
  })
})

describe("aggregateStats", () => {
  test("aggregates multiple sessions correctly", () => {
    const session1 = parseSessionParts(
      "ses_1",
      "Session 1",
      { created: 1000, updated: 2000 },
      [toolPart("fdx-read"), agentPart("heidi"), stepFinishPart(100, 50, 10, 0.001)],
    )
    const session2 = parseSessionParts(
      "ses_2",
      "Session 2",
      { created: 3000, updated: 4000 },
      [toolPart("fdx-read"), toolPart("fdx-search", "error"), agentPart("tester")],
    )

    const agg = aggregateStats([session1, session2])

    expect(agg.totalToolCalls).toBe(3)
    expect(agg.totalToolErrors).toBe(1)
    expect(agg.toolBreakdown["fdx-read"]).toEqual({ total: 2, errors: 0 })
    expect(agg.toolBreakdown["fdx-search"]).toEqual({ total: 1, errors: 1 })
    expect(agg.agentBreakdown["heidi"]).toBe(1)
    expect(agg.agentBreakdown["tester"]).toBe(1)
    expect(agg.totalTokens.input).toBe(100)
    expect(agg.totalCost).toBeCloseTo(0.001)
  })

  test("tracks pipeline completion rate", () => {
    const session1 = parseSessionParts(
      "ses_1",
      "Done",
      { created: 1000, updated: 2000 },
      [textPart("/fd-task started"), textPart("/fd-done completed")],
    )
    const session2 = parseSessionParts(
      "ses_2",
      "In progress",
      { created: 3000, updated: 4000 },
      [textPart("/fd-task started")],
    )

    const agg = aggregateStats([session1, session2])

    expect(agg.pipelineStarts).toBe(2)
    expect(agg.pipelineCompletions).toBe(1)
    expect(agg.stageFrequency.task).toBe(2)
    expect(agg.stageFrequency.done).toBe(1)
  })

  test("handles empty input", () => {
    const agg = aggregateStats([])

    expect(agg.totalToolCalls).toBe(0)
    expect(agg.totalToolErrors).toBe(0)
    expect(agg.pipelineStarts).toBe(0)
    expect(agg.sessions).toHaveLength(0)
  })
})
