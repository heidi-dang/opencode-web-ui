import { agentBackendManager } from "../backend/manager"
import { openControlPlaneDatabase } from "../control-plane/database/client"
import { importLegacyRegistry } from "../control-plane/migration/import"

let migrationPromise: Promise<unknown> | undefined
export async function getBootstrap() { const started = Date.now(); migrationPromise ||= (async () => { const db = openControlPlaneDatabase(); try { return await importLegacyRegistry(db) } finally { db.close() } })(); await migrationPromise; const backends = await agentBackendManager.list(); return { backends, activeBackendId: undefined, recentWorkspaces: [], preferences: {}, runtime: { controlPlane: "database-primary", generatedAt: new Date().toISOString(), latencyMs: Date.now() - started } } }
