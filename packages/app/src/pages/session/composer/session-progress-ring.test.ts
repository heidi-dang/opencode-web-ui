import { describe, expect, test } from "bun:test"
import { getTodoProgress } from "./session-progress-ring"

describe("session todo progress", () => {
  test("treats completed and cancelled todos as terminal", () => {
    expect(
      getTodoProgress([
        { status: "completed" },
        { status: "cancelled" },
        { status: "in_progress" },
        { status: "pending" },
      ]),
    ).toEqual({ total: 4, done: 2, fraction: 0.5 })
  })

  test("returns an empty safe progress value when no todos exist", () => {
    expect(getTodoProgress([])).toEqual({ total: 0, done: 0, fraction: 0 })
  })

  test("does not exceed complete progress after reconnect updates", () => {
    expect(getTodoProgress([{ status: "completed" }, { status: "cancelled" }])).toEqual({
      total: 2,
      done: 2,
      fraction: 1,
    })
  })
})
