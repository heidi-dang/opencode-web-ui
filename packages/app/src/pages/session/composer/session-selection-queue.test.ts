import { describe, expect, test } from "bun:test"
import { createSessionSelectionQueue } from "./session-selection-queue"

describe("createSessionSelectionQueue", () => {
  test("commits only after the server mutation succeeds", async () => {
    const applied: string[] = []
    const committed: string[] = []
    let release!: () => void
    const queue = createSessionSelectionQueue({
      apply: async (value: string) => {
        applied.push(value)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      },
      commit: (value) => committed.push(value),
    })

    const result = queue.set("model-b")
    expect(queue.pending()).toBe(true)
    expect(committed).toEqual([])

    release()
    expect(await result).toBe(true)
    expect(applied).toEqual(["model-b"])
    expect(committed).toEqual(["model-b"])
  })

  test("serializes rapid changes and leaves the latest server selection committed", async () => {
    const applied: string[] = []
    const committed: string[] = []
    let releaseFirst!: () => void
    const queue = createSessionSelectionQueue({
      apply: async (value: string) => {
        applied.push(value)
        if (value === "model-b") {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
        }
      },
      commit: (value) => committed.push(value),
    })

    const first = queue.set("model-b")
    const latest = queue.set("model-d")

    expect(applied).toEqual(["model-b"])
    releaseFirst()

    expect(await first).toBe(false)
    expect(await latest).toBe(true)
    expect(await queue.wait()).toBe(true)
    expect(applied).toEqual(["model-b", "model-d"])
    expect(committed).toEqual(["model-b", "model-d"])
  })

  test("reports failure without committing the rejected selection", async () => {
    const committed: string[] = []
    const errors: unknown[] = []
    const queue = createSessionSelectionQueue({
      apply: async () => {
        throw new Error("model unavailable")
      },
      commit: (value: string) => committed.push(value),
      onError: (error) => errors.push(error),
    })

    expect(await queue.set("model-b")).toBe(false)
    expect(committed).toEqual([])
    expect(errors).toHaveLength(1)
    expect(await queue.wait()).toBe(false)
  })

  test("keeps the last acknowledged value when a superseding request fails", async () => {
    const committed: string[] = []
    const queue = createSessionSelectionQueue({
      apply: async (value: string) => {
        if (value === "model-c") throw new Error("model unavailable")
      },
      commit: (value) => committed.push(value),
    })

    const first = queue.set("model-b")
    const latest = queue.set("model-c")

    expect(await first).toBe(false)
    expect(await latest).toBe(false)
    expect(committed).toEqual(["model-b"])
    expect(await queue.wait()).toBe(false)
  })
})
