import type { BackendDescriptor } from "../../backend/domain"
import { openControlPlaneDatabase } from "../database/client"

export function listPrimaryBackends(): BackendDescriptor[] {
  const db = openControlPlaneDatabase()
  try {
    const state = db.query("SELECT value FROM control_plane_meta WHERE key='registry_migration'").get() as { value?: string } | null
    if (state?.value !== "DATABASE_PRIMARY") return []
    const rows = db.query("SELECT id,type,name,endpoint,enabled,state,protocol,capabilities,created_at,updated_at,last_seen_at FROM agent_backends ORDER BY created_at").all() as Array<Record<string, unknown>>
    return rows.map((row) => ({ id: String(row.id), type: String(row.type), name: String(row.name), endpoint: String(row.endpoint), enabled: Boolean(row.enabled), state: String(row.state) as BackendDescriptor["state"], protocol: row.protocol ? String(row.protocol) : undefined, capabilities: JSON.parse(String(row.capabilities)), createdAt: new Date(Number(row.created_at)).toISOString(), updatedAt: new Date(Number(row.updated_at)).toISOString(), lastSeenAt: row.last_seen_at ? new Date(Number(row.last_seen_at)).toISOString() : undefined }))
  } finally { db.close() }
}
