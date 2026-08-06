export const MODEL_ACTIVITY_WAVEFORM_BASE_DURATION_MS = 1_800

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function modelActivityWaveformPlaybackRate(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1
  return MODEL_ACTIVITY_WAVEFORM_BASE_DURATION_MS / durationMs
}

export function modelActivityWaveformArrivalOffset(trackWidth: number, packetWidth: number) {
  if (!Number.isFinite(trackWidth) || !Number.isFinite(packetWidth) || trackWidth <= 0 || packetWidth <= 0) return 0.82
  return clamp(trackWidth / (trackWidth + packetWidth), 0.12, 0.96)
}

export function modelActivityWaveformArrivalKeyframes(offset: number): Keyframe[] {
  const peak = clamp(offset, 0.12, 0.96)
  const shoulder = Math.min(0.08, peak / 2, (1 - peak) / 2)
  return [
    { opacity: "0", offset: 0 },
    { opacity: "0", offset: peak - shoulder },
    { opacity: "calc(var(--wave-arrival-visible) * 0.85)", offset: peak },
    { opacity: "0", offset: peak + shoulder },
    { opacity: "0", offset: 1 },
  ]
}
