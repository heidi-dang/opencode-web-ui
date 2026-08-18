import type { BackendDescriptor, BackendType } from "../../backend/domain"
import { openControlPlaneDatabase } from "../database/client"
import { decryptCredential, encryptCredential } from "../encryption/credentials"

function primaryState(db: ReturnType<typeof openControlPlaneDatabase>) {
  return (db.query("SELECT value FROM control_plane_meta WHERE key='registry_migration'").get() as { value?: string } | null)?.value === "DATABASE_PRIMARY"
}

export function isDatabasePrimary() { const db = openControlPlaneDatabase(); try { return primaryState(db) } finally { db.close() } }

export function listPrimaryBackends(): BackendDescriptor[] {
  const db = openControlPlaneDatabase()
  try {
    if (!primaryState(db)) return []
    const rows = db.query("SELECT id,type,name,endpoint,enabled,state,protocol,capabilities,created_at,updated_at,last_seen_at FROM agent_backends ORDER BY created_at").all() as Array<Record<string, unknown>>
    return rows.map((row) => ({ id: String(row.id), type: String(row.type), name: String(row.name), endpoint: String(row.endpoint), enabled: Boolean(row.enabled), state: String(row.state) as BackendDescriptor["state"], protocol: row.protocol ? String(row.protocol) : undefined, capabilities: JSON.parse(String(row.capabilities)), createdAt: new Date(Number(row.created_at)).toISOString(), updatedAt: new Date(Number(row.updated_at)).toISOString(), lastSeenAt: row.last_seen_at ? new Date(Number(row.last_seen_at)).toISOString() : undefined }))
  } finally { db.close() }
}

export function getPrimaryBackend(id: string): BackendDescriptor | undefined { return listPrimaryBackends().find((backend) => backend.id === id) }

export function insertPrimaryBackend(input: { id: string; type?: BackendType; name: string; endpoint: string; enabled: boolean; username?: string; password?: string }) {
  const db = openControlPlaneDatabase()
  try {
    if (!primaryState(db)) return false
    const now = Date.now()
    db.transaction(() => {
      db.query("INSERT INTO agent_backends (id,type,name,endpoint,enabled,state,capabilities,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(input.id, input.type || "opencode", input.name, input.endpoint, input.enabled ? 1 : 0, "REGISTERED", JSON.stringify({ projects: true, sessions: true, tools: true, permissions: true }), now, now)
      if (input.username || input.password) db.query("INSERT INTO backend_credentials (backend_id,encrypted_username,encrypted_password,version,updated_at) VALUES (?,?,?,?,?)").run(input.id, input.username ? encryptCredential(input.username) : null, input.password ? encryptCredential(input.password) : null, 1, now)
    })()
    return true
  } finally { db.close() }
}

export function updatePrimaryBackend(id: string, input: { name?: string; endpoint?: string; enabled?: boolean; username?: string; password?: string }) {
  const db = openControlPlaneDatabase()
  try {
    if (!primaryState(db)) return false
    const current = db.query("SELECT id FROM agent_backends WHERE id=?").get(id)
    if (!current) return false
    const sets: string[] = []; const values: unknown[] = []
    for (const [column, value] of [["name", input.name], ["endpoint", input.endpoint], ["enabled", input.enabled === undefined ? undefined : input.enabled ? 1 : 0]] as const) if (value !== undefined) { sets.push(`${column}=?`); values.push(value) }
    sets.push("state='REGISTERED'", "protocol=NULL", "updated_at=?"); values.push(Date.now(), id)
    db.query(`UPDATE agent_backends SET ${sets.join(",")} WHERE id=?`).run(...(values as Array<string | number | boolean | null>))
    if (input.username !== undefined || input.password !== undefined) db.query("INSERT OR REPLACE INTO backend_credentials (backend_id,encrypted_username,encrypted_password,version,updated_at) VALUES (?,?,?,?,?)").run(id, input.username ? encryptCredential(input.username) : null, input.password ? encryptCredential(input.password) : null, 1, Date.now())
    return true
  } finally { db.close() }
}

export function getPrimaryCredentials(id: string) { const db = openControlPlaneDatabase(); try { if (!primaryState(db)) return {}; const row = db.query("SELECT encrypted_username, encrypted_password FROM backend_credentials WHERE backend_id=?").get(id) as { encrypted_username?: string; encrypted_password?: string } | null; return { username: row?.encrypted_username ? decryptCredential(row.encrypted_username) : undefined, password: row?.encrypted_password ? decryptCredential(row.encrypted_password) : undefined } } finally { db.close() } }

export function deletePrimaryBackend(id: string) { const db = openControlPlaneDatabase(); try { if (!primaryState(db)) return false; return db.query("DELETE FROM agent_backends WHERE id=?").run(id).changes > 0 } finally { db.close() } }

export function updatePrimaryHealth(id: string, health: { state: string; protocol?: string; reachable?: boolean; authenticated?: boolean; healthy?: boolean; latencyMs?: number; error?: string }) { const db = openControlPlaneDatabase(); try { if (!primaryState(db)) return false; const now = Date.now(); db.query("UPDATE agent_backends SET state=?, protocol=?, updated_at=?, last_seen_at=? WHERE id=?").run(health.state, health.protocol || null, now, health.healthy ? now : null, id); db.query("INSERT OR REPLACE INTO backend_health (backend_id,reachable,authenticated,healthy,latency_ms,error,checked_at) VALUES (?,?,?,?,?,?,?)").run(id, health.reachable ? 1 : 0, health.authenticated ? 1 : 0, health.healthy ? 1 : 0, health.latencyMs || null, health.error || null, now); return true } finally { db.close() } }
