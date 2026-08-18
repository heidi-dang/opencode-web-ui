import { describe, expect, test } from "bun:test"
import { modelActivityIsStalled } from "./activity-config"

describe("modelActivityIsStalled", () => {
  test("requires a meaningful event timestamp", () => {
    expect(modelActivityIsStalled(0, 20_000, 15_000)).toBe(false)
  })

  test("detects silence at the configured threshold", () => {
    expect(modelActivityIsStalled(5_000, 20_000, 15_000)).toBe(true)
    expect(modelActivityIsStalled(5_001, 20_000, 15_000)).toBe(false)
  })
})
