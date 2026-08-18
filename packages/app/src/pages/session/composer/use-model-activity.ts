import { createSignal, createRenderEffect, onCleanup, createMemo } from "solid-js"
import { useSync } from "@/context/sync"
import { ActivityConfig, modelActivityIsStalled, type ModelActivityState } from "./activity-config"
import { useServerSDK } from "@/context/server-sdk"

export function useModelActivity(sessionID: () => string, sync = useSync()) {

  const serverSDK = useServerSDK()

  // Track the derived state
  const [state, setState] = createSignal<ModelActivityState>("idle")
  
  // Track EWMA of intervals
  const [ewma, setEwma] = createSignal<number>(ActivityConfig.FAST_CADENCE_MS)
  const [lastProcessedEventTime, setLastProcessedEventTime] = createSignal<number>(0)
  const [timeSinceLastActivity, setTimeSinceLastActivity] = createSignal<number>(0)
  const hasActivity = createMemo(() => lastProcessedEventTime() > 0)

  // Use memos for reactive access to the normalized store
  const isWorking = createMemo(() => sync().data.session_working(sessionID()))
  const lastEventAt = createMemo(() => sync().data.session_activity?.[sessionID()]?.lastMeaningfulEventAt ?? 0)
  
  // Determine if waiting for input or permission
  const questions = createMemo(() => sync().data.question[sessionID()] ?? [])
  const permissions = createMemo(() => sync().data.permission[sessionID()] ?? [])
  const waitingForInput = createMemo(() => questions().length > 0 || permissions().length > 0)
  
  const todos = createMemo(() => sync().data.todo[sessionID()] ?? [])
  const waitingForTool = createMemo(() => todos().some(t => t.status === "in_progress"))
  let recoveryRequested = false

  // Evaluation loop
  createRenderEffect(() => {
    // If not working, clear timer and set appropriate resting state
    if (!isWorking()) {
      recoveryRequested = false
      setState("idle")
      setLastProcessedEventTime(0)
      setTimeSinceLastActivity(0)
      return
    }

    // Interval to evaluate stalled or fast/slow
    const evaluate = () => {
      const now = Date.now()
      const eventTime = lastEventAt()
      const previousEventTime = lastProcessedEventTime()
      if (eventTime > 0 && eventTime !== previousEventTime) {
        const interval = previousEventTime === 0 ? 0 : eventTime - previousEventTime
        if (interval > 0) {
          setEwma((current) => ActivityConfig.EWMA_ALPHA * interval + (1 - ActivityConfig.EWMA_ALPHA) * current)
        }
        setLastProcessedEventTime(eventTime)
      }
      const last = Math.max(lastProcessedEventTime(), eventTime)
      const timeSince = last === 0 ? 0 : now - last
      
      setTimeSinceLastActivity(timeSince)

      // Priority overrides
      if (waitingForInput()) {
        setState("waiting-input")
        return
      }

      if (waitingForTool()) {
        setState("waiting-tool")
        return
      }
      
      if (modelActivityIsStalled(last, now)) {
        setState("stalled")
        if (!recoveryRequested) {
          recoveryRequested = true
          void serverSDK()
            .connection.reconnect()
            .catch((error) => {
              console.error("[session] stalled execution recovery failed", {
                error: error instanceof Error ? error.message : "unknown recovery error",
              })
            })
        }
      } else {
        if (ewma() <= ActivityConfig.FAST_CADENCE_MS) {
          setState("active-fast")
        } else {
          setState("active-slow")
        }
      }
    }

    // Run immediately and set up interval
    evaluate()
    const interval = setInterval(evaluate, ActivityConfig.EVALUATION_INTERVAL_MS)
    
    onCleanup(() => {
      clearInterval(interval)
    })
  })

  return { state, timeSinceLastActivity, ewma, hasActivity }
}
