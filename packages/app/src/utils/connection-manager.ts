export type ConnectionState =
  | "CONNECTING"
  | "HEALTHY"
  | "PROTOCOL_READY"
  | "STREAM_READY"
  | "READY"
  | "DEGRADED"
  | "RECONNECTING"
  | "UNHEALTHY"

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN"

export type ConnectionSnapshot = {
  state: ConnectionState
  protocol?: "v1" | "v2"
  failures: number
  latencyMs?: number
  lastError?: unknown
  changedAt: number
  circuit: CircuitState
  nextProbeAt?: number
}

type ManagerOptions = {
  probe: () => Promise<"v1" | "v2">
  maxFailures?: number
  baseDelayMs?: number
  maxDelayMs?: number
  cooldownMs?: number
  random?: () => number
  onChange?: (snapshot: ConnectionSnapshot) => void
}

export class ConnectionManager {
  private readonly options: Required<Pick<ManagerOptions, "maxFailures" | "baseDelayMs" | "maxDelayMs" | "cooldownMs" | "random">>
  private snapshotValue: ConnectionSnapshot = { state: "CONNECTING", failures: 0, circuit: "CLOSED", changedAt: Date.now() }
  private protocolValue?: "v1" | "v2"
  private connecting?: Promise<"v1" | "v2">

  constructor(private readonly probe: ManagerOptions["probe"], options: Omit<ManagerOptions, "probe"> = {}) {
    this.options = {
      maxFailures: options.maxFailures ?? 3,
      baseDelayMs: options.baseDelayMs ?? 250,
      maxDelayMs: options.maxDelayMs ?? 10_000,
      cooldownMs: options.cooldownMs ?? 5_000,
      random: options.random ?? Math.random,
    }
    this.onChange = options.onChange
  }

  readonly onChange?: ManagerOptions["onChange"]

  get snapshot() {
    return this.snapshotValue
  }

  get protocol() {
    return this.protocolValue
  }

  async connect() {
    if (this.snapshotValue.circuit === "OPEN") {
      const nextProbeAt = this.snapshotValue.nextProbeAt ?? 0
      if (Date.now() < nextProbeAt) throw new Error("Connection circuit is open")
      this.setState("RECONNECTING", { circuit: "HALF_OPEN", nextProbeAt: undefined })
    }
    if (this.protocolValue) return this.protocolValue
    if (this.connecting) return this.connecting
    this.setState("CONNECTING")
    const startedAt = Date.now()
    this.connecting = this.probe()
      .then((protocol) => {
        this.protocolValue = protocol
        this.setState("HEALTHY", { protocol, failures: 0, circuit: "CLOSED", nextProbeAt: undefined, latencyMs: Date.now() - startedAt })
        this.setState("PROTOCOL_READY", { protocol })
        return protocol
      })
      .catch((error) => {
        this.recordFailure(error)
        throw error
      })
      .finally(() => {
        this.connecting = undefined
      })
    return this.connecting
  }

  markStreamReady() {
    if (!this.protocolValue) return
    this.setState("STREAM_READY", { protocol: this.protocolValue })
    this.setState("READY", { protocol: this.protocolValue })
  }

  markStreamFailure(error: unknown) {
    this.recordFailure(error)
    this.protocolValue = undefined
  }

  invalidate(error?: unknown) {
    this.protocolValue = undefined
    this.setState(error ? "DEGRADED" : "RECONNECTING", { lastError: error })
  }

  reset() {
    this.protocolValue = undefined
    this.setState("CONNECTING", { failures: 0, circuit: "CLOSED", nextProbeAt: undefined, lastError: undefined })
  }

  retryDelay() {
    const exponential = Math.min(this.options.maxDelayMs, this.options.baseDelayMs * 2 ** Math.max(0, this.snapshotValue.failures - 1))
    return Math.round(exponential * (0.8 + this.options.random() * 0.4))
  }

  isCircuitOpen() {
    return this.snapshotValue.circuit === "OPEN"
  }

  circuitState() {
    return this.snapshotValue.circuit
  }

  private recordFailure(error: unknown) {
    const failures = this.snapshotValue.failures + 1
    const open = failures >= this.options.maxFailures
    this.setState(open ? "UNHEALTHY" : "RECONNECTING", {
      failures,
      lastError: error,
      circuit: open ? "OPEN" : this.snapshotValue.circuit,
      nextProbeAt: open ? Date.now() + this.options.cooldownMs : this.snapshotValue.nextProbeAt,
    })
  }

  private setState(state: ConnectionState, patch: Partial<ConnectionSnapshot> = {}) {
    this.snapshotValue = { ...this.snapshotValue, ...patch, state, changedAt: Date.now() }
    this.onChange?.(this.snapshotValue)
  }
}

export function createConnectionManager(options: ManagerOptions) {
  return new ConnectionManager(options.probe, options)
}
