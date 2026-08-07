import { describe, expect, test } from "bun:test"
import type { Todo } from "@opencode-ai/sdk/v2/client"
import { todoSignature } from "./todo-signature"

describe("todoSignature", () => {
  test("changes when a same-length todo changes status", () => {
    const pending: Todo[] = [{ content: "Checkpoint 1", status: "pending", priority: "high" }]
    const active: Todo[] = [{ content: "Checkpoint 1", status: "in_progress", priority: "high" }]

    expect(todoSignature(pending)).not.toBe(todoSignature(active))
  })
})
