import type { Database } from "bun:sqlite"
import { listServers } from "../../server-registry"
import { encryptCredential } from "../encryption/credentials"
import { migrateControlPlaneDatabase } from "../database/client"

export async function importLegacyRegistry(db: Database) {
  migrateControlPlaneDatabase(db)
  const state = db.query("SELECT value FROM control_plane_meta WHERE key='registry_migration'").get() as { value?: string } | null
  if (state?.value === "DATABASE_PRIMARY") return { imported: false, state: "DATABASE_PRIMARY" as const }

  const servers = await listServers()
  try {
    return db.transaction(() => {
    const current = db.query("SELECT value FROM control_plane_meta WHERE key='registry_migration'").get() as { value?: string } | null
    if (current?.value === "DATABASE_PRIMARY") return { imported: false, state: "DATABASE_PRIMARY" as const }

    db.query("UPDATE control_plane_meta SET value='IMPORTING', updated_at=? WHERE key='registry_migration'").run(Date.now())
    const insert = db.prepare("INSERT OR IGNORE INTO agent_backends (id,type,name,endpoint,enabled,state,protocol,capabilities,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    const credential = db.prepare("INSERT OR REPLACE INTO backend_credentials (backend_id,encrypted_username,encrypted_password,version,updated_at) VALUES (?,?,?,?,?)")
    const now = Date.now()
    for (const server of servers) {
      insert.run(server.id, "opencode", server.name, server.baseUrl, server.enabled ? 1 : 0, server.state, server.protocol || null, JSON.stringify({ projects: true, sessions: true, tools: true, permissions: true }), now, now)
      if (server.username || server.password) credential.run(server.id, server.username ? encryptCredential(server.username) : null, server.password ? encryptCredential(server.password) : null, 1, now)
    }
    db.query("UPDATE control_plane_meta SET value='DATABASE_PRIMARY', updated_at=? WHERE key='registry_migration'").run(Date.now())
    return { imported: true, state: "DATABASE_PRIMARY" as const, count: servers.length }
    })()
  } catch (error) {
    db.query("UPDATE control_plane_meta SET value='IMPORT_FAILED', updated_at=? WHERE key='registry_migration'").run(Date.now())
    throw error
  }
}
