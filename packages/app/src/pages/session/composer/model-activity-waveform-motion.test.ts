import { describe, expect, test } from "bun:test"
import {
  MODEL_ACTIVITY_WAVEFORM_BASE_DURATION_MS,
  modelActivityWaveformArrivalKeyframes,
  modelActivityWaveformArrivalOffset,
  modelActivityWaveformPlaybackRate,
} from "./model-activity-waveform-motion"

describe("model activity waveform motion", () => {
  test("maps target duration to a fixed-timeline playback rate", () => {
    expect(modelActivityWaveformPlaybackRate(MODEL_ACTIVITY_WAVEFORM_BASE_DURATION_MS)).toBe(1)
    expect(modelActivityWaveformPlaybackRate(600)).toBe(3)
    expect(modelActivityWaveformPlaybackRate(0)).toBe(1)
    expect(modelActivityWaveformPlaybackRate(Number.NaN)).toBe(1)
  })

  test("places the arrival peak where the packet reaches the responsive endpoint", () => {
    expect(modelActivityWaveformArrivalOffset(240, 60)).toBe(0.8)
    expect(modelActivityWaveformArrivalOffset(60, 60)).toBe(0.5)
    expect(modelActivityWaveformArrivalOffset(0, 60)).toBe(0.82)
  })

  test("builds an opacity-only arrival envelope around the peak", () => {
    const frames = modelActivityWaveformArrivalKeyframes(0.7)
    const offsets = frames.map((frame) => Number(frame.offset))
    const expectedOffsets = [0, 0.62, 0.7, 0.78, 1]
    expectedOffsets.forEach((expected, index) => expect(offsets[index]).toBeCloseTo(expected, 6))
    expect(frames.every((frame) => Object.keys(frame).every((key) => key === "offset" || key === "opacity"))).toBe(
      true,
    )
  })
})
