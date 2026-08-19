import { agentBackendManager } from "../backend/manager"
import { getServer, publicServer, updateServerHealth, registerServer as registerLegacyServer, updateServer as updateLegacyServer, deleteServer as deleteLegacyServer, type RegisteredServer } from "../server-registry"
import { deletePrimaryBackend, insertPrimaryBackend, isDatabasePrimary, updatePrimaryBackend, updatePrimaryHealth } from "../control-plane/repositories/backend-repository"
import { normalizeBackendEndpoint } from "../backend/network"
import { runtimeLogger } from "../observability/logger"

export async function listBackendDescriptors() {
  try {
    const result = await agentBackendManager.list()
    runtimeLogger.debug("backend.list.complete", { backendCount: result.length, enabledBackendCount: result.filter((backend) => backend.enabled).length })
    return result
  } catch (error) {
    runtimeLogger.error("backend.list.error", { error })
    throw error
  }
}

export async function getBackend(id: string) {
  runtimeLogger.debug("backend.get", { backendId: id })
  return agentBackendManager.get(id)
}

export async function registerBackend(input: { name?: string; baseUrl: string; username?: string; password?: string; enabled?: boolean }) {
  const started = Date.now()
  runtimeLogger.info("backend.register.start", { endpoint: input.baseUrl, enabled: input.enabled !== false, authConfigured: Boolean(input.username || input.password) })
  try {
    if (isDatabasePrimary()) {
      const endpoint = normalizeBackendEndpoint(input.baseUrl)
      const id = `srv_${crypto.randomUUID()}`
      if (!insertPrimaryBackend({ id, name: input.name?.trim() || new URL(endpoint).hostname, endpoint, enabled: input.enabled !== false, username: input.username, password: input.password })) throw new Error("DUPLICATE_SERVER_URL")
      const result = (await listBackendDescriptors()).find((backend) => backend.id === id)
      runtimeLogger.info("backend.register.complete", { backendId: id, endpoint, durationMs: Date.now() - started })
      return result
    }
    const server = await registerLegacyServer(input)
    runtimeLogger.info("backend.register.complete", { backendId: server.id, endpoint: server.baseUrl, durationMs: Date.now() - started, storage: "legacy" })
    return server
  } catch (error) {
    runtimeLogger.error("backend.register.error", { endpoint: input.baseUrl, durationMs: Date.now() - started, error })
    throw error
  }
}

export async function updateBackend(id: string, input: { name?: string; baseUrl?: string; username?: string; password?: string; enabled?: boolean }) {
  const started = Date.now()
  runtimeLogger.info("backend.update.start", { backendId: id, changedFields: Object.entries(input).filter(([, value]) => value !== undefined).map(([key]) => key) })
  try {
    if (isDatabasePrimary()) {
      const updated = updatePrimaryBackend(id, { name: input.name, endpoint: input.baseUrl ? normalizeBackendEndpoint(input.baseUrl) : undefined, enabled: input.enabled, username: input.username, password: input.password })
      if (!updated) return undefined
      await agentBackendManager.invalidate(id)
      const result = (await listBackendDescriptors()).find((backend) => backend.id === id)
      runtimeLogger.info("backend.update.complete", { backendId: id, endpoint: input.baseUrl, durationMs: Date.now() - started })
      return result
    }
    const result = await updateLegacyServer(id, input)
    runtimeLogger.info("backend.update.complete", { backendId: id, endpoint: result?.baseUrl, durationMs: Date.now() - started, storage: "legacy" })
    return result
  } catch (error) {
    runtimeLogger.error("backend.update.error", { backendId: id, endpoint: input.baseUrl, durationMs: Date.now() - started, error })
    throw error
  }
}

export async function deleteBackend(id: string) {
  runtimeLogger.info("backend.delete", { backendId: id })
  try {
    if (isDatabasePrimary()) {
      await agentBackendManager.invalidate(id)
      const deleted = deletePrimaryBackend(id)
      runtimeLogger.info("backend.delete.complete", { backendId: id, deleted })
      return deleted
    }
    const deleted = deleteLegacyServer(id)
    runtimeLogger.info("backend.delete.complete", { backendId: id, deleted, storage: "legacy" })
    return deleted
  } catch (error) {
    runtimeLogger.error("backend.delete.error", { backendId: id, error })
    throw error
  }
}

export async function probeBackend(id: string, recovery = false) {
  const started = Date.now()
  runtimeLogger.debug(recovery ? "health.recovery.start" : "health.start", { backendId: id, recovery })
  try {
    const health = await agentBackendManager.health(id, recovery)
    const server = await getServer(id)
    if (!server) throw new Error("SERVER_NOT_FOUND")
    const state: RegisteredServer["state"] = health.healthy ? "READY" : health.authenticated ? "UNHEALTHY" : "AUTH_FAILED"
    const update = { state, protocol: health.protocol, reachable: health.reachable, authenticated: health.authenticated, healthy: health.healthy, latencyMs: health.latencyMs, error: health.error as never }
    const updated = isDatabasePrimary() ? (updatePrimaryHealth(id, update), await getServer(id)) : await updateServerHealth(id, update)
    runtimeLogger.debug(recovery ? "health.recovery.complete" : "health.complete", { backendId: id, protocol: health.protocol, reachable: health.reachable, authenticated: health.authenticated, healthy: health.healthy, latencyMs: health.latencyMs, durationMs: Date.now() - started })
    return { server: publicServer(updated || server), health }
  } catch (error) {
    runtimeLogger.error(recovery ? "health.recovery.error" : "health.error", { backendId: id, durationMs: Date.now() - started, error })
    throw error
  }
}
