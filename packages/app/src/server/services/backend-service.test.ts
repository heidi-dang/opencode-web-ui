import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { join } from "node:path"
import { agentBackendManager } from "../backend/manager"
import { probeBackend, registerBackend } from "./backend-service"
import { resetRegistryForTests } from "../server-registry"

describe("backend service", () => {
  test("returns the server descriptor after persisting probe readiness", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR || "/tmp", "opencode-backend-service-"))
    const previousStore = process.env.OPENCODE_SERVERS_STORE
    const previousMode = process.env.CONTROL_PLANE_LEGACY_TEST_MODE
    const previousFetch = globalThis.fetch
    process.env.OPENCODE_SERVERS_STORE = join(directory, "servers.json")
    process.env.CONTROL_PLANE_LEGACY_TEST_MODE = "1"
    resetRegistryForTests()
    globalThis.fetch = (async () => Response.json({ healthy: true })) as unknown as typeof fetch
    let backendId: string | undefined

    try {
      const registered = await registerBackend({ baseUrl: "https://fixture.example" })
      if (!registered) throw new Error("fixture registration failed")
      backendId = registered.id
      const result = await probeBackend(registered.id)
      expect(result.health).toMatchObject({ healthy: true, authenticated: true, reachable: true })
      expect(result.server).toMatchObject({ id: registered.id, state: "READY", protocol: "v2" })
    } finally {
      if (backendId) await agentBackendManager.invalidate(backendId)
      globalThis.fetch = previousFetch
      if (previousStore === undefined) delete process.env.OPENCODE_SERVERS_STORE
      else process.env.OPENCODE_SERVERS_STORE = previousStore
      if (previousMode === undefined) delete process.env.CONTROL_PLANE_LEGACY_TEST_MODE
      else process.env.CONTROL_PLANE_LEGACY_TEST_MODE = previousMode
      await rm(directory, { recursive: true, force: true })
    }
  })
})
