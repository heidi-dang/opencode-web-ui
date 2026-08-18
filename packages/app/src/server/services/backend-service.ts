import { agentBackendManager } from "../backend/manager"
import { getServer, listServers, probeRegisteredServer, publicServer, updateServerHealth } from "../server-registry"

export async function listBackendDescriptors() { return agentBackendManager.list() }
export async function getBackend(id: string) { return agentBackendManager.get(id) }
export async function probeBackend(id: string, recovery = false) { const health = await agentBackendManager.health(id, recovery); const server = await getServer(id); if (!server) throw new Error("SERVER_NOT_FOUND"); const updated = await updateServerHealth(id, { state: health.healthy ? "READY" : health.authenticated ? "UNHEALTHY" : "AUTH_FAILED", reachable: health.reachable, authenticated: health.authenticated, healthy: health.healthy, latencyMs: health.latencyMs, error: health.error as never }); return { server: publicServer(updated || server), health } }
export { listServers }
