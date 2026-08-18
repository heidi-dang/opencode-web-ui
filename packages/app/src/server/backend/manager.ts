import type { AgentBackend } from "./agent-backend"
import { CircuitBreaker } from "./circuit-breaker"
import type { BackendDescriptor } from "./domain"
import { OpenCodeAdapter } from "./adapters/opencode/adapter"
import { getServer, listServers } from "../server-registry"
import { listPrimaryBackends } from "../control-plane/repositories/backend-repository"

export class AgentBackendManager {
  private readonly instances = new Map<string, AgentBackend>()
  private readonly pendingInstances = new Map<string, Promise<AgentBackend>>()
  private readonly circuits = new Map<string, CircuitBreaker>()
  private readonly healthProbes = new Map<string, Promise<Awaited<ReturnType<AgentBackend["health"]>>>>()
  async list(): Promise<BackendDescriptor[]> { const primary = listPrimaryBackends(); if (primary.length) return primary; const servers = await listServers(); return Promise.all(servers.map(async (server) => (await this.get(server.id)).descriptor)) }
  async get(id: string) {
    const existing = this.instances.get(id)
    if (existing) return existing
    const pending = this.pendingInstances.get(id)
    if (pending) return pending
    const creation = this.create(id).finally(() => {
      if (this.pendingInstances.get(id) === creation) this.pendingInstances.delete(id)
    })
    this.pendingInstances.set(id, creation)
    return creation
  }
  private async create(id: string) {
    const server = await getServer(id)
    if (!server) throw new Error("SERVER_NOT_FOUND")
    const backend = new OpenCodeAdapter(server)
    this.instances.set(id, backend)
    this.circuits.set(id, new CircuitBreaker())
    return backend
  }
  async health(id: string, recovery = false, signal?: AbortSignal) {
    if (!recovery) {
      const existing = this.healthProbes.get(id)
      if (existing) return existing
    }
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
    try {
      const result = await backend.health(signal)
      if (result.healthy) circuit.success()
      else circuit.failure(result.authenticated)
      return result
    } catch (error) {
      circuit.failure(error instanceof Error && !/^BACKEND_HTTP_(401|403)$/.test(error.message))
      throw error
    }
  }
  async run<T>(id: string, operation: (backend: AgentBackend, signal?: AbortSignal) => Promise<T>, signal?: AbortSignal) { const backend = await this.get(id); const circuit = this.circuits.get(id)!; if (!circuit.canRequest()) throw new Error("BACKEND_CIRCUIT_OPEN"); try { const value = await operation(backend, signal); circuit.success(); return value } catch (error) { circuit.failure(error instanceof Error && !/^BACKEND_HTTP_(401|403)$/.test(error.message)); throw error } }
  metrics() { return { runtimes: this.instances.size, pendingRuntimes: this.pendingInstances.size, healthProbes: this.healthProbes.size, circuits: this.circuits.size } }
  async invalidate(id: string) {
    await this.pendingInstances.get(id)?.catch(() => undefined)
    const backend = this.instances.get(id)
    await backend?.disconnect().catch(() => undefined)
    this.instances.delete(id)
    this.pendingInstances.delete(id)
    this.healthProbes.delete(id)
    this.circuits.delete(id)
  }
}
export const agentBackendManager = new AgentBackendManager()
