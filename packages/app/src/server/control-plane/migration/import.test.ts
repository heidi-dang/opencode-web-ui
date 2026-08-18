import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openControlPlaneDatabase, migrateControlPlaneDatabase } from "../database/client"
import { importLegacyRegistry } from "./import"

describe("control-plane database migration state", () => {
  test("initializes deterministically and is idempotent", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-control-plane-"))
    const filename = join(directory, "control-plane.sqlite")
    const first = openControlPlaneDatabase(filename)
    migrateControlPlaneDatabase(first)
    const initial = first.query("SELECT value FROM control_plane_meta WHERE key='registry_migration'").get() as { value: string }
    first.close()
    const second = openControlPlaneDatabase(filename)
    migrateControlPlaneDatabase(second)
    const repeated = second.query("SELECT value FROM control_plane_meta WHERE key='registry_migration'").get() as { value: string }
    const tables = second.query("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_backends'").all()
    second.close()
    await rm(directory, { recursive: true, force: true })
    expect(initial.value).toBe("LEGACY_ONLY")
    expect(repeated.value).toBe("LEGACY_ONLY")
    expect(tables).toHaveLength(1)
  })

  test("cuts over once and remains database primary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opencode-control-plane-cutover-"))
    const filename = join(directory, "control-plane.sqlite")
    const legacyStore = join(directory, "legacy-registry.json")
    const previousDb = process.env.CONTROL_PLANE_DB
    const previousStore = process.env.OPENCODE_SERVERS_STORE
    const previousKey = process.env.APP_ENCRYPTION_KEY
    process.env.CONTROL_PLANE_DB = filename
    process.env.OPENCODE_SERVERS_STORE = legacyStore
    process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64")
    try {
      const first = openControlPlaneDatabase(filename)
      const imported = await importLegacyRegistry(first)
      first.close()
      const second = openControlPlaneDatabase(filename)
      const repeated = await importLegacyRegistry(second)
      const state = second.query("SELECT value FROM control_plane_meta WHERE key='registry_migration'").get() as { value: string }
      second.close()
      expect(imported).toMatchObject({ imported: true, state: "DATABASE_PRIMARY" })
      expect(repeated).toEqual({ imported: false, state: "DATABASE_PRIMARY" })
      expect(state.value).toBe("DATABASE_PRIMARY")
    } finally {
      if (previousDb === undefined) delete process.env.CONTROL_PLANE_DB
      else process.env.CONTROL_PLANE_DB = previousDb
      if (previousStore === undefined) delete process.env.OPENCODE_SERVERS_STORE
      else process.env.OPENCODE_SERVERS_STORE = previousStore
      if (previousKey === undefined) delete process.env.APP_ENCRYPTION_KEY
      else process.env.APP_ENCRYPTION_KEY = previousKey
      await rm(directory, { recursive: true, force: true })
    }
  })
})
