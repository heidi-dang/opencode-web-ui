import { createSignal, createEffect, onCleanup, createMemo } from "solid-js"
import { useSync } from "@/context/sync"
import { ActivityConfig, type ModelActivityState } from "./activity-config"

export function useModelActivity(sessionID: () => string) {
  const sync = useSync()

  // Track the derived state
  const [state, setState] = createSignal<ModelActivityState>("idle")
  
  // Track EWMA of intervals
  const [ewma, setEwma] = createSignal<number>(ActivityConfig.FAST_CADENCE_MS)
  const [lastProcessedEventTime, setLastProcessedEventTime] = createSignal<number>(0)
  const [timeSinceLastActivity, setTimeSinceLastActivity] = createSignal<number>(0)

  // Use memos for reactive access to the normalized store
  const isWorking = createMemo(() => sync().data.session_working(sessionID()))
  const lastEventAt = createMemo(() => sync().data.session_activity[sessionID()]?.lastMeaningfulEventAt ?? 0)
  
  // Determine if waiting for input or permission
  const questions = createMemo(() => sync().data.question[sessionID()] ?? [])
  const permissions = createMemo(() => sync().data.permission[sessionID()] ?? [])
  const waitingForInput = createMemo(() => questions().length > 0 || permissions().length > 0)
  
  const todos = createMemo(() => sync().data.todo[sessionID()] ?? [])
  const waitingForTool = createMemo(() => todos().some(t => t.status === "in_progress"))

  // Effect to process new events and update EWMA
  createEffect(() => {
    const currentEventTime = lastEventAt()
    if (currentEventTime === 0) return
    
    setLastProcessedEventTime(prev => {
      // If we haven't seen an event yet, just initialize
      if (prev === 0) return currentEventTime
      
      const interval = currentEventTime - prev
      if (interval > 0) {
        // Update EWMA
        setEwma(current => {
          return ActivityConfig.EWMA_ALPHA * interval + (1 - ActivityConfig.EWMA_ALPHA) * current
        })
      }
      return currentEventTime
    })
  })
  
  // Evaluation loop
  createEffect(() => {
    // If not working, clear timer and set appropriate resting state
    if (!isWorking()) {
      setState("idle")
      setLastProcessedEventTime(0)
      setTimeSinceLastActivity(0)
      return
    }

    // Interval to evaluate stalled or fast/slow
    const evaluate = () => {
      const now = Date.now()
      const last = Math.max(lastProcessedEventTime(), lastEventAt())
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
      
      if (last !== 0 && timeSince >= ActivityConfig.STALL_THRESHOLD_MS) {
        setState("stalled")
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

  return { state, timeSinceLastActivity, ewma }
}
