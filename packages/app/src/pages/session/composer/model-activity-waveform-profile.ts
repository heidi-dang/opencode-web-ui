import type { ModelActivityState } from "./activity-config"

export type ModelActivityWaveformProfile = {
  durationMs: number
  amplitude: number
  glow: number
  moving: boolean
  tone: "accent" | "warning" | "danger" | "muted"
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const rounded = (value: number) => Math.round(value * 1_000) / 1_000
const RECENT_ACTIVITY_BOOST_MS = 1_200

export function modelActivityWaveformRecentBoost(
  ageMs: number,
  hasActivity: boolean,
  reducedMotion = false,
): number {
  if (!hasActivity || reducedMotion || !Number.isFinite(ageMs) || ageMs < 0 || ageMs >= RECENT_ACTIVITY_BOOST_MS) {
    return 0
  }
  return rounded(1 - ageMs / RECENT_ACTIVITY_BOOST_MS)
}

export function modelActivityWaveformProfile(
  state: ModelActivityState,
  ewmaMs: number,
  reducedMotion = false,
): ModelActivityWaveformProfile {
  const cadence = clamp(Number.isFinite(ewmaMs) ? ewmaMs : 1_800, 250, 1_800)
  const energy = 1 - (cadence - 250) / 1_550
  const active = {
    durationMs: Math.round(600 + (1 - energy) * 1_200),
    amplitude: rounded(0.72 + energy * 0.38),
    glow: rounded(0.42 + energy * 0.48),
    moving: !reducedMotion,
    tone: "accent" as const,
  }

  if (state === "active-fast" || state === "active-slow") return active
  if (state === "waiting-tool" || state === "waiting-input") {
    return { durationMs: 2_400, amplitude: 0.62, glow: 0.42, moving: !reducedMotion, tone: "warning" }
  }
  if (state === "stalled") {
    return { durationMs: 3_400, amplitude: 0.48, glow: 0.24, moving: !reducedMotion, tone: "warning" }
  }
  if (state === "error" || state === "disconnected") {
    return { durationMs: 0, amplitude: 0.58, glow: 0.48, moving: false, tone: "danger" }
  }
  return { durationMs: 0, amplitude: 0.52, glow: 0.2, moving: false, tone: "muted" }
}
