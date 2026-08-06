import { Show, createMemo } from "solid-js"
import { useLanguage } from "@/context/language"
import { useModelActivity } from "./use-model-activity"
import { ModelActivityState } from "./activity-config"

import "./model-activity.css"

export function ModelActivityHeartbeat(props: { sessionID: string }) {
  const language = useLanguage()
  const { state, timeSinceLastActivity } = useModelActivity(() => props.sessionID)

  // Map state to CSS classes
  const pulseClass = createMemo(() => {
    const current = state()
    switch (current) {
      case "active-fast":
        return "heartbeat-fast"
      case "active-slow":
        return "heartbeat-slow"
      case "stalled":
        return "heartbeat-stalled"
      case "waiting-tool":
      case "waiting-input":
        return "heartbeat-waiting"
      case "error":
      case "disconnected":
        return "heartbeat-error"
      case "completed":
      case "idle":
      default:
        return "heartbeat-idle"
    }
  })

  // Determine indicator color token based on state
  const indicatorColor = createMemo(() => {
    const current = state()
    switch (current) {
      case "active-fast":
      case "active-slow":
        return "var(--v2-text-text-accent)" // Emerald/Indigo typical accent
      case "waiting-tool":
      case "waiting-input":
        return "var(--v2-state-fg-warning)" // Amber
      case "stalled":
        return "var(--v2-state-fg-warning)" // Amber warning
      case "error":
      case "disconnected":
        return "var(--v2-state-fg-danger)"
      case "completed":
      case "idle":
      default:
        return "var(--v2-text-text-faint)"
    }
  })

  // Format time since last activity for tooltip
  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000)
    if (s < 1) return "< 1s"
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    return `${m}m ${s % 60}s`
  }

  // Get accessibility and tooltip text
  const statusLabel = createMemo(() => {
    const current = state()
    let label = language.t(`session.status.heartbeat.${current}`)
    
    // Fallback if translations aren't added yet
    if (!label || label.startsWith("session.status")) {
      switch (current) {
        case "active-fast": label = "Thinking rapidly"; break
        case "active-slow": label = "Processing"; break
        case "waiting-tool": label = "Waiting for tool"; break
        case "waiting-input": label = "Waiting for input"; break
        case "stalled": label = "Stalled"; break
        case "error": label = "Error"; break
        case "idle": label = "Idle"; break
        default: label = current
      }
    }

    if (current === "active-fast" || current === "active-slow" || current === "stalled" || current === "waiting-tool") {
      return `${label} (${formatTime(timeSinceLastActivity())} since last activity)`
    }
    
    return label
  })

  return (
    <div
      class="model-activity-heartbeat"
      data-state={state()}
      title={statusLabel()}
      role="status"
      aria-live="polite"
      aria-label={statusLabel()}
    >
      <div
        class={`heartbeat-indicator ${pulseClass()}`}
        style={{
          color: indicatorColor(),
          "background-color": indicatorColor(),
        }}
      />
    </div>
  )
}
