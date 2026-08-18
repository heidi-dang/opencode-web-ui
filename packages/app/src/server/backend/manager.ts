import type { AgentBackend } from "./agent-backend"
import { CircuitBreaker } from "./circuit-breaker"
import type { BackendDescriptor } from "./domain"
import { OpenCodeAdapter } from "./adapters/opencode/adapter"
import { getServer, listServers } from "../server-registry"
import { listPrimaryBackends } from "../control-plane/repositories/backend-repository"

export class AgentBackendManager {
  private readonly instances = new Map<string, AgentBackend>()
  private readonly circuits = new Map<string, CircuitBreaker>()
  async list(): Promise<BackendDescriptor[]> { const primary = listPrimaryBackends(); if (primary.length) return primary; const servers = await listServers(); return Promise.all(servers.map(async (server) => (await this.get(server.id)).descriptor)) }
  async get(id: string) { const existing = this.instances.get(id); if (existing) return existing; const server = await getServer(id); if (!server) throw new Error("SERVER_NOT_FOUND"); const backend = new OpenCodeAdapter(server); this.instances.set(id, backend); this.circuits.set(id, new CircuitBreaker()); return backend }
  async health(id: string, recovery = false) { const backend = await this.get(id); const circuit = this.circuits.get(id)!; if (!recovery && !circuit.canRequest()) throw new Error("BACKEND_CIRCUIT_OPEN"); if (recovery && !circuit.tryRecoveryProbe() && !circuit.canRequest()) throw new Error("BACKEND_CIRCUIT_OPEN"); try { const result = await backend.health(); if (result.healthy) circuit.success(); else circuit.failure(result.authenticated); return result } catch (error) { circuit.failure(true); throw error } }
  private getOrCreate(id: string) { const existing = this.instances.get(id); if (existing) return existing; throw new Error("BACKEND_NOT_INITIALIZED") }
  async invalidate(id: string) { const backend = this.instances.get(id); await backend?.disconnect().catch(() => undefined); this.instances.delete(id); this.circuits.delete(id) }
}
export const agentBackendManager = new AgentBackendManager()
