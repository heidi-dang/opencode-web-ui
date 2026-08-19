import { agentBackendManager } from "../backend/manager"
import { openControlPlaneDatabase } from "../control-plane/database/client"
import { importLegacyRegistry } from "../control-plane/migration/import"
import { runtimeLogger } from "../observability/logger"

let migrationPromise: Promise<unknown> | undefined
export async function getBootstrap() {
  const started = Date.now()
  runtimeLogger.debug("bootstrap.start")
  const migrationState = migrationPromise ? "in_flight_or_complete" : "not_started"
  runtimeLogger.debug("bootstrap.migration_state", { migrationState })
  migrationPromise ||= (async () => {
    const db = openControlPlaneDatabase()
    try {
      const result = await importLegacyRegistry(db)
      runtimeLogger.info("bootstrap.migration_complete", { imported: result })
      return result
    } catch (error) {
      runtimeLogger.error("bootstrap.migration_error", { error })
      throw error
    } finally {
      db.close()
    }
  })()
  try {
    await migrationPromise
    const backends = await agentBackendManager.list()
    const enabledBackendCount = backends.filter((backend) => backend.enabled).length
    runtimeLogger.debug("bootstrap.backends_loaded", { backendCount: backends.length, enabledBackendCount })
    const result = { backends, activeBackendId: undefined, recentWorkspaces: [], preferences: {}, runtime: { controlPlane: "database-primary", generatedAt: new Date().toISOString(), latencyMs: Date.now() - started } }
    runtimeLogger.debug("bootstrap.complete", { backendCount: backends.length, enabledBackendCount, durationMs: Date.now() - started })
    return result
  } catch (error) {
    runtimeLogger.error("bootstrap.error", { durationMs: Date.now() - started, error })
    throw error
  }
}
