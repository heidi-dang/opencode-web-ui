export type TransportMetrics = {
  requests: number
  failures: number
  inFlight: number
  totalLatencyMs: number
  lastLatencyMs?: number
  lastFailureAt?: number
}

export function createServerTransport(input: {
  fetch?: typeof globalThis.fetch
  onMetrics?: (metrics: TransportMetrics) => void
} = {}) {
  const fetcher = input.fetch ?? globalThis.fetch
  const metrics: TransportMetrics = { requests: 0, failures: 0, inFlight: 0, totalLatencyMs: 0 }

  const request = (async (resource: RequestInfo | URL, init?: RequestInit) => {
    const startedAt = Date.now()
    metrics.requests++
    metrics.inFlight++
    try {
      const response = await fetcher(resource, init)
      if (!response.ok) {
        metrics.failures++
        metrics.lastFailureAt = Date.now()
      }
      return response
    } catch (error) {
      metrics.failures++
      metrics.lastFailureAt = Date.now()
      throw error
    } finally {
      metrics.inFlight--
      metrics.lastLatencyMs = Date.now() - startedAt
      metrics.totalLatencyMs += metrics.lastLatencyMs
      input.onMetrics?.({ ...metrics })
    }
  }) as typeof globalThis.fetch

  return { request, metrics: () => ({ ...metrics }) }
}
