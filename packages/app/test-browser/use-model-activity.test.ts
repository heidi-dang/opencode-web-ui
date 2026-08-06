import { describe, test, expect, beforeEach, afterEach, vi } from "bun:test"
import { createRoot } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { ActivityConfig } from "@/pages/session/composer/activity-config"

let _mockData: any
let _setMockData: any

createRoot(() => {
  const [data, setData] = createStore<any>({
    __working: false,
    session_working: (id: string) => data.__working,
    session_activity: {},
    question: {},
    permission: {},
    todo: {},
  })
  _mockData = data
  _setMockData = setData
})

export const setMockData = (data: any) => {
  for (const [key, value] of Object.entries(data)) {
    _setMockData(key, value && typeof value === "object" ? reconcile(value) : value)
  }
}

import { useModelActivity } from "@/pages/session/composer/use-model-activity"

const sync = () => ({ data: _mockData })

describe("useModelActivity", () => {
  let _now = 10000

  const advance = (ms: number) => {
    _now += ms
    vi.advanceTimersByTime(ms)
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Date, "now").mockImplementation(() => _now)
    setMockData({
      __working: false,
      session_activity: {},
      question: {},
      permission: {},
      todo: {},
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("initializes in idle state", () => {
    createRoot((dispose) => {
      const { state, timeSinceLastActivity } = useModelActivity(() => "session-1", sync)
      expect(state()).toBe("idle")
      expect(timeSinceLastActivity()).toBe(0)
      dispose()
    })
  })

  test("transitions to active-fast on rapid events", () => {
    createRoot((dispose) => {
      setMockData({
        __working: true,
        session_activity: { "session-1": { lastMeaningfulEventAt: Date.now() } },
      })
      const { state, ewma } = useModelActivity(() => "session-1", sync)
      
      advance(200)
      setMockData({ session_activity: { "session-1": { lastMeaningfulEventAt: Date.now() } } })
      
      advance(200)
      setMockData({ session_activity: { "session-1": { lastMeaningfulEventAt: Date.now() } } })
      
      advance(ActivityConfig.EVALUATION_INTERVAL_MS)
      
      expect(state()).toBe("active-fast")
      expect(ewma()).toBeLessThanOrEqual(ActivityConfig.FAST_CADENCE_MS)
      
      dispose()
    })
  })

  test("transitions to active-slow on delayed events", () => {
    createRoot((dispose) => {
      setMockData({
        __working: true,
        session_activity: { "session-1": { lastMeaningfulEventAt: Date.now() } },
      })
      const { state, ewma } = useModelActivity(() => "session-1", sync)
      
      advance(ActivityConfig.FAST_CADENCE_MS * 2)
      setMockData({ session_activity: { "session-1": { lastMeaningfulEventAt: Date.now() } } })
      
      advance(ActivityConfig.FAST_CADENCE_MS * 2)
      setMockData({ session_activity: { "session-1": { lastMeaningfulEventAt: Date.now() } } })
      
      advance(ActivityConfig.EVALUATION_INTERVAL_MS)
      
      expect(ewma()).toBeGreaterThan(ActivityConfig.FAST_CADENCE_MS)
      expect(state()).toBe("active-slow")
      
      dispose()
    })
  })

  test("transitions to stalled after long silence", () => {
    createRoot((dispose) => {
      setMockData({
        __working: true,
        session_activity: { "session-1": { lastMeaningfulEventAt: Date.now() } },
      })
      const { state } = useModelActivity(() => "session-1", sync)
      
      advance(ActivityConfig.STALL_THRESHOLD_MS + 100)
      
      expect(state()).toBe("stalled")
      
      dispose()
    })
  })

  test("overrides with waiting-input", () => {
    createRoot((dispose) => {
      setMockData({
        __working: true,
        session_activity: { "session-1": { lastMeaningfulEventAt: Date.now() } },
        question: { "session-1": [{ id: "q1" }] },
      })
      const { state } = useModelActivity(() => "session-1", sync)
      
      advance(ActivityConfig.EVALUATION_INTERVAL_MS)
      
      expect(state()).toBe("waiting-input")
      
      dispose()
    })
  })

  test("overrides with waiting-tool", () => {
    createRoot((dispose) => {
      setMockData({
        __working: true,
        session_activity: { "session-1": { lastMeaningfulEventAt: Date.now() } },
        todo: { "session-1": [{ status: "in_progress" }] },
      })
      const { state } = useModelActivity(() => "session-1", sync)
      
      advance(ActivityConfig.EVALUATION_INTERVAL_MS)
      
      expect(state()).toBe("waiting-tool")
      
      dispose()
    })
  })
})
