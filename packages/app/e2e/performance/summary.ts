export type PerformanceSummary = {
  metric: string
  sampleCount: number
  median: number
  p95: number
  baselineMedian?: number
  absoluteDelta?: number
  percentageDelta?: number
}

export function summarizePerformance(metric: string, samples: number[], baselineSamples?: number[]): PerformanceSummary {
  if (!samples.length) throw new Error(`No samples for ${metric}`)
  const sorted = [...samples].sort((a, b) => a - b)
  const median = percentile(sorted, 0.5)
  const p95 = percentile(sorted, 0.95)
  if (!baselineSamples?.length) return { metric, sampleCount: samples.length, median, p95 }
  const baselineMedian = percentile([...baselineSamples].sort((a, b) => a - b), 0.5)
  const absoluteDelta = median - baselineMedian
  return { metric, sampleCount: samples.length, median, p95, baselineMedian, absoluteDelta, percentageDelta: baselineMedian === 0 ? undefined : (absoluteDelta / baselineMedian) * 100 }
}

function percentile(sorted: number[], quantile: number) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1))
  return sorted[index]
}
