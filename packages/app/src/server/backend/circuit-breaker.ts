export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN"
export type CircuitOptions = { failureThreshold?: number; resetTimeoutMs?: number; halfOpenMaxProbes?: number }

export class CircuitBreaker {
  private state: CircuitState = "CLOSED"
  private failures = 0
  private openedAt = 0
  private probes = 0
  private readonly options: Required<CircuitOptions>
  constructor(options: CircuitOptions = {}) { this.options = { failureThreshold: 3, resetTimeoutMs: 15_000, halfOpenMaxProbes: 1, ...options } }
  get snapshot() { return { state: this.state, failures: this.failures, probes: this.probes } }
  canRequest() { if (this.state === "CLOSED") return true; if (this.state === "OPEN") return false; return false }
  tryRecoveryProbe() { if (this.state === "CLOSED") return false; if (this.state === "OPEN" && Date.now() - this.openedAt < this.options.resetTimeoutMs) return false; if (this.probes >= this.options.halfOpenMaxProbes) return false; this.state = "HALF_OPEN"; this.probes++; return true }
  success() { this.state = "CLOSED"; this.failures = 0; this.probes = 0 }
  failure(authenticated = true) { this.probes = Math.max(0, this.probes - 1); if (!authenticated) return; this.failures++; if (this.failures >= this.options.failureThreshold) { this.state = "OPEN"; this.openedAt = Date.now() } }
}
