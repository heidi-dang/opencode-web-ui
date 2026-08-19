import type { AgentBackend } from "./agent-backend"
import { CircuitBreaker } from "./circuit-breaker"
import type { BackendDescriptor } from "./domain"
import { OpenCodeAdapter } from "./adapters/opencode/adapter"
import { getServer, listServers } from "../server-registry"
import { isDatabasePrimary, listPrimaryBackends } from "../control-plane/repositories/backend-repository"
import { runtimeLogger } from "../observability/logger"

export class AgentBackendManager {
  private readonly instances = new Map<string, AgentBackend>()
  private readonly pendingInstances = new Map<string, Promise<AgentBackend>>()
  private readonly circuits = new Map<string, CircuitBreaker>()
  private readonly healthProbes = new Map<string, Promise<Awaited<ReturnType<AgentBackend["health"]>>>>()
  async list(): Promise<BackendDescriptor[]> { if (isDatabasePrimary()) return listPrimaryBackends(); const servers = await listServers(); return Promise.all(servers.map(async (server) => (await this.get(server.id)).descriptor)) }
  async get(id: string) {
    const existing = this.instances.get(id)
    if (existing) { runtimeLogger.debug("runtime.reuse", { backendId: id, runtimeCount: this.instances.size, pendingRuntimeCount: this.pendingInstances.size }); return existing }
    const pending = this.pendingInstances.get(id)
    if (pending) { runtimeLogger.debug("runtime.pending_reuse", { backendId: id, runtimeCount: this.instances.size, pendingRuntimeCount: this.pendingInstances.size }); return pending }
    const creation = this.create(id).finally(() => {
      if (this.pendingInstances.get(id) === creation) this.pendingInstances.delete(id)
    })
    this.pendingInstances.set(id, creation)
    return creation
  }
  private async create(id: string) {
    runtimeLogger.debug("runtime.create.start", { backendId: id, runtimeCount: this.instances.size, pendingRuntimeCount: this.pendingInstances.size })
    const server = await getServer(id)
    if (!server) throw new Error("SERVER_NOT_FOUND")
    const backend = new OpenCodeAdapter(server)
    this.instances.set(id, backend)
    this.circuits.set(id, new CircuitBreaker())
    runtimeLogger.info("runtime.create.complete", { backendId: id, runtimeCount: this.instances.size, pendingRuntimeCount: this.pendingInstances.size })
    return backend
  }
  async health(id: string, recovery = false, signal?: AbortSignal) {
    if (!recovery) {
      const existing = this.healthProbes.get(id)
      if (existing) { runtimeLogger.debug("health.deduplicated", { backendId: id }); return existing }
    }
    runtimeLogger.debug("health.probe.start", { backendId: id, recovery })
    const probe = this.performHealth(id, recovery, signal)
    if (!recovery) {
      this.healthProbes.set(id, probe)
      void probe.finally(() => {
        if (this.healthProbes.get(id) === probe) this.healthProbes.delete(id)
      }).catch(() => undefined)
    }
    return probe
  }
  private async performHealth(id: string, recovery: boolean, signal?: AbortSignal) {
    const backend = await this.get(id)
    const circuit = this.circuits.get(id)!
    if (!recovery && !circuit.canRequest()) throw new Error("BACKEND_CIRCUIT_OPEN")
    if (recovery && !circuit.tryRecoveryProbe() && !circuit.canRequest()) throw new Error("BACKEND_CIRCUIT_OPEN")
    const before = circuit.snapshot
    try {
      const result = await backend.health(signal)
      if (result.healthy) circuit.success()
      else circuit.failure(!result.reachable || result.authenticated)
      const after = circuit.snapshot
      if (before.state !== after.state) runtimeLogger.info(after.state === "OPEN" ? "circuit.open" : "circuit.closed_after_recovery", { backendId: id, previousState: before.state, circuitState: after.state })
      runtimeLogger.debug("health.probe.complete", { backendId: id, recovery, protocol: result.protocol, reachable: result.reachable, authenticated: result.authenticated, healthy: result.healthy, latencyMs: result.latencyMs, circuitState: after.state })
      return result
    } catch (error) {
      circuit.failure(error instanceof Error && !/^BACKEND_HTTP_(401|403)$/.test(error.message))
      const after = circuit.snapshot
      runtimeLogger.warn(after.state === "OPEN" ? "circuit.open" : "circuit.failure", { backendId: id, previousState: before.state, circuitState: after.state, error })
      throw error
    }
  }
  async run<T>(id: string, operation: (backend: AgentBackend, signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) { const backend = await this.get(id); const circuit = this.circuits.get(id)!; if (!circuit.canRequest()) { runtimeLogger.warn("circuit.request_blocked", { backendId: id, circuitState: circuit.snapshot.state }); throw new Error("BACKEND_CIRCUIT_OPEN") } try { const value = await operation(backend, signal); circuit.success(); return value } catch (error) { const before = circuit.snapshot; circuit.failure(error instanceof Error && !/^BACKEND_HTTP_(401|403)$/.test(error.message)); const after = circuit.snapshot; runtimeLogger.warn("backend.operation.error", { backendId: id, circuitState: after.state, previousState: before.state, error }); if (before.state !== after.state) runtimeLogger.warn("circuit.open", { backendId: id, previousState: before.state, circuitState: after.state }); throw error } }
  metrics() { return { runtimes: this.instances.size, pendingRuntimes: this.pendingInstances.size, healthProbes: this.healthProbes.size, circuits: this.circuits.size } }
  async invalidate(id: string) {
    runtimeLogger.info("runtime.invalidate.start", { backendId: id, runtimeCount: this.instances.size, pendingRuntimeCount: this.pendingInstances.size })
    await this.pendingInstances.get(id)?.catch(() => undefined)
    const backend = this.instances.get(id)
    await backend?.disconnect().catch(() => undefined)
    this.instances.delete(id)
    this.pendingInstances.delete(id)
    this.healthProbes.delete(id)
    this.circuits.delete(id)
    runtimeLogger.info("runtime.invalidate.complete", { backendId: id, runtimeCount: this.instances.size, pendingRuntimeCount: this.pendingInstances.size })
  }
}
export const agentBackendManager = new AgentBackendManager()
