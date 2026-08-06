import { createMemo, type ParentProps } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { useLanguage } from "@/context/language"
import type { ModelActivityState } from "./activity-config"
import { modelActivityWaveformProfile } from "./model-activity-waveform-profile"
import { useModelActivity } from "./use-model-activity"

import "./model-activity-waveform.css"

const signalPath = "M0 12 H14 L20 8 L27 17 L35 12 H45 L51 2 L59 22 L67 7 L75 17 L83 12 H100"

const fallbackLabel = {
  "active-fast": "Thinking rapidly",
  "active-slow": "Processing",
  "waiting-tool": "Waiting for tool",
  "waiting-input": "Waiting for input",
  stalled: "Stalled",
  error: "Error",
  disconnected: "Disconnected",
  completed: "Completed",
  idle: "Idle",
} satisfies Record<ModelActivityState, string>

const formatTime = (ms: number) => {
  const seconds = Math.floor(ms / 1_000)
  if (seconds < 1) return "< 1s"
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export function ModelActivityWaveform(props: ParentProps<{ sessionID: string; hasTelemetry: boolean }>) {
  const language = useLanguage()
  const activity = useModelActivity(() => props.sessionID)
  const reducedMotion = createMediaQuery("(prefers-reduced-motion: reduce)")
  const profile = createMemo(() => modelActivityWaveformProfile(activity.state(), activity.ewma(), reducedMotion()))

  const conciseStatusLabel = createMemo(() => {
    const current = activity.state()
    const translated = language.t(`session.status.heartbeat.${current}`)
    return !translated || translated.startsWith("session.status") ? fallbackLabel[current] : translated
  })

  const statusLabel = createMemo(() => {
    const current = activity.state()
    const label = conciseStatusLabel()
    if (["active-fast", "active-slow", "stalled", "waiting-tool"].includes(current)) {
      return `${label} (${formatTime(activity.timeSinceLastActivity())} since last activity)`
    }
    return label
  })

  return (
    <div
      class="model-activity-waveform"
      data-component="model-activity-waveform"
      data-state={activity.state()}
      data-tone={profile().tone}
      data-motion={profile().moving ? "active" : "static"}
      data-has-telemetry={props.hasTelemetry ? "true" : "false"}
      style={`--wave-duration:${profile().durationMs}ms;--wave-amplitude:${profile().amplitude};--wave-glow:${profile().glow}`}
    >
      <span class="sr-only" data-slot="model-activity-waveform-status">
        {conciseStatusLabel()}
      </span>
      <div data-slot="model-activity-waveform-track" aria-hidden="true" title={statusLabel()}>
        <span class="model-activity-waveform-rail" data-slot="model-activity-waveform-rail" />
        <div data-slot="model-activity-waveform-runner">
          <svg viewBox="0 0 100 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <g class="model-activity-waveform-lines">
              <path class="model-activity-waveform-depth" d={signalPath} />
              <path data-slot="model-activity-waveform-signal" d={signalPath} />
            </g>
          </svg>
        </div>
      </div>
      <div data-slot="model-activity-waveform-telemetry">
        <span
          class="model-activity-waveform-arrival-glow"
          data-slot="model-activity-waveform-arrival-glow"
          aria-hidden="true"
        />
        {props.children}
      </div>
    </div>
  )
}
