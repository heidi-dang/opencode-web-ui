import { describe, expect, test } from "bun:test"
import { summarizePerformance } from "../summary"

describe("performance summaries", () => {
  test("reports median and p95 from repeatable samples", () => {
    expect(summarizePerformance("health", [30, 10, 20, 40, 50])).toEqual({ metric: "health", sampleCount: 5, median: 30, p95: 50 })
  })

  test("compares final samples against a baseline", () => {
    expect(summarizePerformance("bootstrap", [12, 14, 16], [10, 10, 10])).toMatchObject({ metric: "bootstrap", sampleCount: 3, median: 14, p95: 16, baselineMedian: 10, absoluteDelta: 4, percentageDelta: 40 })
  })
})
