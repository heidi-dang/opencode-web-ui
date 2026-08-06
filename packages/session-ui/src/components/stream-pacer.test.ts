import { expect, test } from "bun:test"
import { createStreamPacer, type StreamPacerClock } from "./stream-pacer"

test("coalesces rapid stream updates into one frame and writes the latest value", () => {
  let value = "a"
  const writes: string[] = []
  const frames = new Map<number, () => void>()
  const timers = new Map<number, () => void>()
  let id = 0
  const clock: StreamPacerClock = {
    frame(callback) {
      frames.set(++id, callback)
      return id
    },
    cancelFrame(next) {
      frames.delete(next)
    },
    timeout(callback) {
      timers.set(++id, callback)
      return id as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout(next) {
      timers.delete(next as unknown as number)
    },
  }
  const pacer = createStreamPacer({ read: () => value, write: (next) => writes.push(next), clock })

  pacer.schedule()
  value = "abc"
  pacer.schedule()
  expect(frames.size).toBe(1)
  expect(timers.size).toBe(1)

  frames.values().next().value?.()
  expect(writes).toEqual(["abc"])
  expect(frames.size).toBe(0)
  expect(timers.size).toBe(0)
})

test("flush publishes final content immediately and cancels scheduled work", () => {
  let cancelled = 0
  const clock: StreamPacerClock = {
    frame: () => 1,
    cancelFrame: () => cancelled++,
    timeout: () => 2 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: () => cancelled++,
  }
  const writes: string[] = []
  const pacer = createStreamPacer({ read: () => "complete", write: (value) => writes.push(value), clock })

  pacer.schedule()
  pacer.flush()

  expect(writes).toEqual(["complete"])
  expect(cancelled).toBe(2)
})
