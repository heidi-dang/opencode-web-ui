import { describe, expect, test } from "bun:test"
import type { Part } from "@opencode-ai/sdk/v2/client"
import { activityHintFromPart } from "./activity-hint"

const part = (input: object) => input as Part

describe("activityHintFromPart", () => {
  test("maps shell-command tools to shell", () => {
    expect(activityHintFromPart(part({ type: "tool", tool: "bash", state: { status: "running", input: {}, time: { start: 1 } } }))).toBe("shell")
    expect(activityHintFromPart(part({ type: "tool", tool: "Command", state: { status: "running", input: {}, time: { start: 1 } } }))).toBe("shell")
  })

  test("maps file/read/search tools to file", () => {
    for (const tool of ["edit", "write", "read", "grep", "glob", "apply_patch", "search"]) {
      expect(activityHintFromPart(part({ type: "tool", tool, state: { status: "running", input: {}, time: { start: 1 } } }))).toBe("file")
    }
  })

  test("maps other tools to tool", () => {
    expect(activityHintFromPart(part({ type: "tool", tool: "agent", state: { status: "running", input: {}, time: { start: 1 } } }))).toBe("tool")
  })

  test("maps step lifecycle parts to step", () => {
    expect(activityHintFromPart(part({ type: "step-start" }))).toBe("step")
    expect(
      activityHintFromPart(
        part({ type: "step-finish", reason: "done", cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }),
      ),
    ).toBe("step")
  })

  test("maps text parts to text", () => {
    expect(activityHintFromPart(part({ type: "text", text: "hello" }))).toBe("text")
  })

  test("maps file and patch parts to file", () => {
    expect(activityHintFromPart(part({ type: "file", mime: "text/plain", url: "file:///a.ts" }))).toBe("file")
    expect(activityHintFromPart(part({ type: "patch", hash: "abc", files: ["a.ts"] }))).toBe("file")
  })

  test("maps reasoning and unknown parts to thinking", () => {
    expect(activityHintFromPart(part({ type: "reasoning", text: "..." }))).toBe("thinking")
    expect(activityHintFromPart(part({ type: "snapshot", snapshot: "s" }))).toBe("thinking")
    expect(activityHintFromPart(undefined)).toBe("thinking")
  })
})