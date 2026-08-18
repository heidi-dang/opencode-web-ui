import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openControlPlaneDatabase, migrateControlPlaneDatabase } from "../database/client"

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
})
