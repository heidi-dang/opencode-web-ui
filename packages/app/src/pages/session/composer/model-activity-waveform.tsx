import { createEffect, createMemo, onCleanup, onMount, type ParentProps } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { useLanguage } from "@/context/language"
import type { ModelActivityState } from "./activity-config"
import {
  modelActivityWaveformProfile,
  modelActivityWaveformRecentBoost,
} from "./model-activity-waveform-profile"
import {
  modelActivityWaveformArrivalKeyframes,
  modelActivityWaveformArrivalOffset,
  modelActivityWaveformPlaybackRate,
} from "./model-activity-waveform-motion"
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
  let track: HTMLDivElement | undefined
  let runner: HTMLDivElement | undefined
  let packet: SVGSVGElement | undefined
  let arrivalGlow: HTMLSpanElement | undefined
  let motionFrame: number | undefined
  let arrivalFrame: number | undefined
  let arrivalOffset = Number.NaN
  let arrivalEffect: KeyframeEffect | undefined
  let resizeObserver: ResizeObserver | undefined
  const language = useLanguage()
  const activity = useModelActivity(() => props.sessionID)
  const reducedMotion = createMediaQuery("(prefers-reduced-motion: reduce)")
  const profile = createMemo(() => modelActivityWaveformProfile(activity.state(), activity.ewma(), reducedMotion()))
  const recentBoost = createMemo(() =>
    modelActivityWaveformRecentBoost(activity.timeSinceLastActivity(), activity.hasActivity(), reducedMotion()),
  )
  const amplitude = createMemo(() => Math.min(1.16, profile().amplitude + recentBoost() * 0.08))
  const glow = createMemo(() => Math.min(1, profile().glow + recentBoost() * 0.12))

  const syncPlaybackRate = (rate: number) => {
    // A fixed effect duration plus updatePlaybackRate keeps the current phase continuous as cadence changes.
    for (const element of [runner, arrivalGlow]) {
      const animation = element?.getAnimations()[0]
      if (!animation || Math.abs(animation.playbackRate - rate) < 0.001) continue
      animation.updatePlaybackRate(rate)
    }
  }

  const syncArrivalOffset = () => {
    if (!track || !packet || !arrivalGlow) return
    const next = modelActivityWaveformArrivalOffset(track.clientWidth, packet.getBoundingClientRect().width)
    const effect = arrivalGlow.getAnimations()[0]?.effect
    if (!(effect instanceof KeyframeEffect)) return
    if (effect === arrivalEffect && Math.abs(next - arrivalOffset) < 0.001) return
    // Reposition only the opacity peak; the persistent glow keeps the runner's animation clock.
    effect.setKeyframes(modelActivityWaveformArrivalKeyframes(next))
    arrivalEffect = effect
    arrivalOffset = next
  }

  createEffect(() => {
    const duration = profile().durationMs
    const moving = profile().moving
    if (motionFrame !== undefined) cancelAnimationFrame(motionFrame)
    if (!moving || duration <= 0) return
    motionFrame = requestAnimationFrame(() => {
      syncPlaybackRate(modelActivityWaveformPlaybackRate(duration))
      syncArrivalOffset()
    })
  })

  onMount(() => {
    resizeObserver = new ResizeObserver(() => {
      if (arrivalFrame !== undefined) cancelAnimationFrame(arrivalFrame)
      arrivalFrame = requestAnimationFrame(syncArrivalOffset)
    })
    if (track) resizeObserver.observe(track)
    if (packet) resizeObserver.observe(packet)
  })

  onCleanup(() => {
    resizeObserver?.disconnect()
    if (motionFrame !== undefined) cancelAnimationFrame(motionFrame)
    if (arrivalFrame !== undefined) cancelAnimationFrame(arrivalFrame)
  })

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
      style={`--wave-duration:${profile().durationMs}ms;--wave-amplitude:${amplitude()};--wave-glow:${glow()};--wave-recent-boost:${recentBoost()}`}
    >
      <span class="sr-only" data-slot="model-activity-waveform-status">
        {conciseStatusLabel()}
      </span>
      <div ref={track} data-slot="model-activity-waveform-track" aria-hidden="true" title={statusLabel()}>
        <span class="model-activity-waveform-rail" data-slot="model-activity-waveform-rail" />
        <div ref={runner} data-slot="model-activity-waveform-runner">
          <svg ref={packet} viewBox="0 0 100 24" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <g class="model-activity-waveform-lines">
              <path class="model-activity-waveform-depth" d={signalPath} />
              <path data-slot="model-activity-waveform-signal" d={signalPath} />
            </g>
          </svg>
        </div>
      </div>
      <div data-slot="model-activity-waveform-telemetry">
        <span
          ref={arrivalGlow}
          class="model-activity-waveform-arrival-glow"
          data-slot="model-activity-waveform-arrival-glow"
          aria-hidden="true"
        />
        {props.children}
      </div>
    </div>
  )
}
