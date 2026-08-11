import { describe, expect, test } from "bun:test"
import {
  offlineQueueManager,
  handle401AuthRefresh,
  formatCorsErrorMessage,
  rateLimitCooldownTracker,
  fetchWithTimeout,
  SSEReconnectController,
  StaleRequestGuard,
  registerImageFallback,
} from "../src/utils/network-boundary"

describe("Network Boundary Utilities", () => {
  test("offlineQueueManager queue lifecycle", () => {
    offlineQueueManager.clearQueue()
    expect(offlineQueueManager.getQueue()).toEqual([])

    offlineQueueManager.enqueue("TEST_ACTION", { data: 123 })
    const queue = offlineQueueManager.getQueue()
    expect(queue.length).toBe(1)
    expect(queue[0].type).toBe("TEST_ACTION")
    expect(queue[0].payload).toEqual({ data: 123 })

    const id = queue[0].id
    offlineQueueManager.removeAction(id)
    expect(offlineQueueManager.getQueue().length).toBe(0)
  })

  test("handle401AuthRefresh", async () => {
    let refreshCalled = 0
    let retryCalled = 0

    const mockResponse401 = { status: 401 } as Response
    const mockResponse200 = { status: 200 } as Response

    const refreshFn = async () => {
      refreshCalled++
      return true
    }
    const retryRequest = async () => {
      retryCalled++
      return mockResponse200
    }

    const res = await handle401AuthRefresh(mockResponse401, refreshFn, retryRequest)
    expect(res.status).toBe(200)
    expect(refreshCalled).toBe(1)
    expect(retryCalled).toBe(1)
  })

  test("formatCorsErrorMessage", () => {
    expect(formatCorsErrorMessage(new Error("Failed to fetch"))).toContain("CORS")
    expect(formatCorsErrorMessage(new Error("Some other error"))).toBe("Some other error")
  })

  test("rateLimitCooldownTracker status", () => {
    let notified = 0
    const unsubscribe = rateLimitCooldownTracker.subscribe(() => {
      notified++
    })

    rateLimitCooldownTracker.setCooldown("/api/test", 2)
    expect(rateLimitCooldownTracker.isLocked("/api/test")).toBe(true)
    expect(rateLimitCooldownTracker.getRemainingSeconds("/api/test")).toBeGreaterThan(0)
    expect(notified).toBe(1)

    unsubscribe()
  })

  test("fetchWithTimeout aborts", async () => {
    let aborted = false
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (input, init) => {
      return new Promise((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true
          reject(new DOMException("Aborted", "AbortError"))
        })
      })
    }

    try {
      await fetchWithTimeout("https://opencode.ai/slow", {}, 10)
      expect(true).toBe(false) // Should not reach here
    } catch (err: any) {
      expect(aborted).toBe(true)
      expect(err.name).toBe("AbortError")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("SSEReconnectController backoff calculation", () => {
    const controller = new SSEReconnectController({
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000,
    })

    expect(controller.getNextDelay()).toBe(100)
    expect(controller.getNextDelay()).toBe(200)
    expect(controller.getNextDelay()).toBe(400)
    expect(controller.getNextDelay()).toBeNull() // Max attempts reached
  })

  test("StaleRequestGuard wraps and discards stale requests", async () => {
    const guard = new StaleRequestGuard<string>()
    let callCount = 0
    let lastResult = ""

    const asyncTask = (val: string, delay: number) =>
      new Promise<string>((resolve) => setTimeout(() => resolve(val), delay))

    const trigger = guard.wrap(
      asyncTask,
      (res) => {
        callCount++
        lastResult = res
      }
    )

    // Trigger two requests: the first is slower, the second is faster
    trigger("first-request", 50)
    trigger("second-request", 10)

    await new Promise((resolve) => setTimeout(resolve, 80))

    // The first request (which resolves after the second is initiated) must be ignored
    expect(callCount).toBe(1)
    expect(lastResult).toBe("second-request")
  })

  test("registerImageFallback chains alternative sources", () => {
    let errorCallback: any
    const mockImg = {
      src: "primary.png",
      addEventListener: (event: string, handler: any) => {
        if (event === "error") errorCallback = handler
      },
      removeEventListener: () => {},
    } as any

    const fallbacks = ["secondary.png", "tertiary.png"]
    registerImageFallback(mockImg, fallbacks)

    expect(mockImg.src).toBe("primary.png")

    // Trigger error on primary image
    errorCallback()
    expect(mockImg.src).toBe("secondary.png")

    // Trigger error on secondary image
    errorCallback()
    expect(mockImg.src).toBe("tertiary.png")
  })
})
