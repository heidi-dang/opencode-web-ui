import { describe, expect, test } from "bun:test"
import { modelActivityWaveformProfile } from "./model-activity-waveform-profile"

describe("modelActivityWaveformProfile", () => {
  test("turns faster cadence into quicker, taller, brighter motion", () => {
    const fast = modelActivityWaveformProfile("active-fast", 250)
    const slow = modelActivityWaveformProfile("active-slow", 1_800)

    expect(fast.durationMs).toBeLessThan(slow.durationMs)
    expect(fast.amplitude).toBeGreaterThan(slow.amplitude)
    expect(fast.glow).toBeGreaterThan(slow.glow)
    expect(fast).toMatchObject({ moving: true, tone: "accent" })
  })

  test("clamps cadence outside the supported range", () => {
    expect(modelActivityWaveformProfile("active-fast", -1)).toEqual(
      modelActivityWaveformProfile("active-fast", 250),
    )
    expect(modelActivityWaveformProfile("active-slow", 99_999)).toEqual(
      modelActivityWaveformProfile("active-slow", 1_800),
    )
  })

  test.each([
    ["waiting-tool", "warning", true],
    ["waiting-input", "warning", true],
    ["stalled", "warning", true],
    ["error", "danger", false],
    ["disconnected", "danger", false],
    ["idle", "muted", false],
    ["completed", "muted", false],
  ] as const)("maps %s to %s with moving=%s", (state, tone, moving) => {
    expect(modelActivityWaveformProfile(state, 900)).toMatchObject({ tone, moving })
  })

  test("reduced motion retains active tone but stops travel", () => {
    expect(modelActivityWaveformProfile("active-fast", 250, true)).toMatchObject({
      tone: "accent",
      moving: false,
    })
  })
})
