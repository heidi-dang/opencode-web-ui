import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { encryptCredential, decryptCredential } from "../control-plane/encryption/credentials"
import { migrateControlPlaneDatabase, openControlPlaneDatabase } from "../control-plane/database/client"
import type { BackendHealth } from "./domain"
import { AgentBackendManager } from "./manager"
import { EventHub } from "./event-hub"
import { CircuitBreaker } from "./circuit-breaker"
import { assertNetworkPolicy, isPrivateAddress, normalizeBackendEndpoint, validateBackendDestination } from "./network"
import { assertImmutableBackendIdentity } from "./domain"
import { resetRegistryForTests } from "../server-registry"
import { isDatabasePrimary } from "../control-plane/repositories/backend-repository"

describe("control server foundation", () => {
  async function withLegacyBackend<T>(run: (manager: AgentBackendManager, id: string) => Promise<T>) {
    const directory = await mkdtemp(join(process.env.TMPDIR || "/tmp", "opencode-backend-runtime-"))
    const previousMode = process.env.CONTROL_PLANE_LEGACY_TEST_MODE
    const previousStore = process.env.OPENCODE_SERVERS_STORE
    const id = "backend-runtime-test"
    process.env.CONTROL_PLANE_LEGACY_TEST_MODE = "1"
    process.env.OPENCODE_SERVERS_STORE = join(directory, "servers.json")
    await writeFile(process.env.OPENCODE_SERVERS_STORE, JSON.stringify({ version: 1, servers: [{ id, name: "Fixture", baseUrl: "https://fixture.example", enabled: true, managed: "runtime", state: "READY", protocol: "v2", updatedAt: new Date().toISOString() }] }))
    const manager = new AgentBackendManager()
    try {
      return await run(manager, id)
    } finally {
      await manager.invalidate(id)
      if (previousMode === undefined) delete process.env.CONTROL_PLANE_LEGACY_TEST_MODE
      else process.env.CONTROL_PLANE_LEGACY_TEST_MODE = previousMode
      if (previousStore === undefined) delete process.env.OPENCODE_SERVERS_STORE
      else process.env.OPENCODE_SERVERS_STORE = previousStore
      await rm(directory, { recursive: true, force: true })
    }
  }

  test("creates one managed runtime for concurrent get calls", async () => {
    await withLegacyBackend(async (manager, id) => {
      const [first, second] = await Promise.all([manager.get(id), manager.get(id)])
      expect(first).toBe(second)
      expect(manager.metrics().runtimes).toBe(1)
    })
  })

  test.serial("does not fall back to stale legacy servers when the primary registry is empty", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR || "/tmp", "opencode-empty-primary-registry-"))
    const filename = join(directory, "control-plane.sqlite")
    const legacyStore = join(directory, "legacy-registry.json")
    const previousDb = process.env.CONTROL_PLANE_DB
    const previousStore = process.env.OPENCODE_SERVERS_STORE
    const previousMode = process.env.CONTROL_PLANE_LEGACY_TEST_MODE
    const manager = new AgentBackendManager()

    process.env.CONTROL_PLANE_DB = filename
    process.env.OPENCODE_SERVERS_STORE = legacyStore
    resetRegistryForTests()
    delete process.env.CONTROL_PLANE_LEGACY_TEST_MODE

    try {
      await writeFile(legacyStore, JSON.stringify({ version: 1, servers: [{ id: "deleted-primary-server", name: "Stale", baseUrl: "https://stale.example", enabled: true, managed: "runtime", state: "READY", updatedAt: new Date().toISOString() }] }))
      const db = openControlPlaneDatabase(filename)
      migrateControlPlaneDatabase(db)
      db.query("UPDATE control_plane_meta SET value='DATABASE_PRIMARY', updated_at=? WHERE key='registry_migration'").run(Date.now())
      db.close()

      expect(isDatabasePrimary()).toBe(true)
      await expect(manager.list()).resolves.toEqual([])
    } finally {
      await manager.invalidate("deleted-primary-server")
      if (previousDb === undefined) delete process.env.CONTROL_PLANE_DB
      else process.env.CONTROL_PLANE_DB = previousDb
      if (previousStore === undefined) delete process.env.OPENCODE_SERVERS_STORE
      else process.env.OPENCODE_SERVERS_STORE = previousStore
      if (previousMode === undefined) delete process.env.CONTROL_PLANE_LEGACY_TEST_MODE
      else process.env.CONTROL_PLANE_LEGACY_TEST_MODE = previousMode
      resetRegistryForTests()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("shares concurrent normal health probes for one backend", async () => {
    await withLegacyBackend(async (manager, id) => {
      const backend = await manager.get(id)
      let calls = 0
      backend.health = async (): Promise<BackendHealth> => {
        calls++
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { backendId: id, reachable: true, authenticated: true, healthy: true, latencyMs: 1, checkedAt: new Date().toISOString() }
      }
      const [first, second] = await Promise.all([manager.health(id), manager.health(id)])
      expect(first).toEqual(second)
      expect(calls).toBe(1)
      expect(manager.metrics().healthProbes).toBe(0)
    })
  })

  test("clears a failed health probe without leaving a rejected cleanup promise", async () => {
    await withLegacyBackend(async (manager, id) => {
      const backend = await manager.get(id)
      backend.health = async () => { throw new Error("fixture health failure") }
      let error: unknown
      try {
        await manager.health(id)
      } catch (cause) {
        error = cause
      }
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe("fixture health failure")
      expect(manager.metrics().healthProbes).toBe(0)
    })
  })

  test("opens the circuit after repeated unreachable health results", async () => {
    await withLegacyBackend(async (manager, id) => {
      const backend = await manager.get(id)
      backend.health = async () => ({ backendId: id, reachable: false, authenticated: false, healthy: false, latencyMs: 1, checkedAt: new Date().toISOString(), error: "CONNECTION_REFUSED" })
      await manager.health(id)
      await manager.health(id)
      await manager.health(id)
      await expect(manager.health(id)).rejects.toThrow("BACKEND_CIRCUIT_OPEN")
    })
  })

  test("encrypts credentials with an authenticated versioned payload", () => { const key = Buffer.alloc(32, 7).toString("base64"); const encrypted = encryptCredential("secret", key); expect(encrypted.startsWith("v1.")).toBe(true); expect(decryptCredential(encrypted, key)).toBe("secret"); expect(() => decryptCredential(encrypted, Buffer.alloc(32, 8).toString("base64"))).toThrow() })
  test("normalizes endpoints and rejects URL credentials", () => { expect(normalizeBackendEndpoint("https://example.test///")).toBe("https://example.test"); expect(() => normalizeBackendEndpoint("https://user:pass@example.test")).toThrow("UNSAFE_SERVER_URL") })
  test("rejects private backend destinations unless the exact origin is allowlisted", () => {
    const previous = process.env.OPENCODE_ALLOWED_SERVERS
    try {
      delete process.env.OPENCODE_ALLOWED_SERVERS
      expect(() => assertNetworkPolicy("http://127.0.0.1:8080")).toThrow("PRIVATE_NETWORK_NOT_ALLOWED")
      expect(() => assertNetworkPolicy("http://169.254.169.254")).toThrow("PRIVATE_NETWORK_NOT_ALLOWED")
      process.env.OPENCODE_ALLOWED_SERVERS = "http://100.97.224.96:4096"
      expect(assertNetworkPolicy("http://100.97.224.96:4096/api/health").hostname).toBe("100.97.224.96")
      expect(() => assertNetworkPolicy("http://100.97.224.97:4096")).toThrow("PRIVATE_NETWORK_NOT_ALLOWED")
      expect(assertNetworkPolicy("https://example.test").hostname).toBe("example.test")
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_ALLOWED_SERVERS
      else process.env.OPENCODE_ALLOWED_SERVERS = previous
    }
  })
  test("rejects private and mixed DNS answers before any upstream request", async () => {
    const lookup = async (hostname: string) => {
      if (hostname === "private.example") return [{ address: "10.20.30.40", family: 4 }]
      if (hostname === "mixed.example") return [{ address: "93.184.216.34", family: 4 }, { address: "192.168.1.8", family: 4 }]
      return [{ address: "93.184.216.34", family: 4 }]
    }
    await expect(validateBackendDestination("http://private.example:4096", { lookup })).rejects.toThrow("PRIVATE_NETWORK_NOT_ALLOWED")
    await expect(validateBackendDestination("http://mixed.example:4096", { lookup })).rejects.toThrow("PRIVATE_NETWORK_NOT_ALLOWED")
    await expect(validateBackendDestination("http://public.example:4096", { lookup })).resolves.toBeInstanceOf(URL)
  })

  test("recognizes loopback, link-local, ULA, and IPv4-mapped private addresses", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true)
    expect(isPrivateAddress("::1")).toBe(true)
    expect(isPrivateAddress("fc00::1")).toBe(true)
    expect(isPrivateAddress("fe80::1")).toBe(true)
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true)
    expect(isPrivateAddress("93.184.216.34")).toBe(false)
  })

  test.serial("enables SQLite foreign keys and cascades backend-owned records", async () => {
    const directory = await mkdtemp(join(process.env.TMPDIR || "/tmp", "opencode-control-plane-fk-"))
    const filename = join(directory, "control-plane.sqlite")
    const db = openControlPlaneDatabase(filename)
    try {
      migrateControlPlaneDatabase(db)
      expect((db.query("PRAGMA foreign_keys").get() as { foreign_keys: number }).foreign_keys).toBe(1)
      const now = Date.now()
      db.query("INSERT INTO agent_backends (id,type,name,endpoint,enabled,state,capabilities,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run("backend-fk", "opencode", "Fixture", "https://fixture.example", 1, "READY", "{}", now, now)
      db.query("INSERT INTO backend_credentials (backend_id,version,updated_at) VALUES (?,?,?)").run("backend-fk", 1, now)
      db.query("INSERT INTO backend_health (backend_id,reachable,authenticated,healthy,checked_at) VALUES (?,?,?,?,?)").run("backend-fk", 1, 1, 1, now)
      db.query("INSERT INTO workspaces (id,backend_id,created_at,updated_at) VALUES (?,?,?,?)").run("workspace-fk", "backend-fk", now, now)
      db.query("INSERT INTO session_index (backend_id,session_id,updated_at) VALUES (?,?,?)").run("backend-fk", "session-fk", now)
      db.query("DELETE FROM agent_backends WHERE id=?").run("backend-fk")
      for (const table of ["backend_credentials", "backend_health", "workspaces", "session_index"]) expect((db.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count).toBe(0)
    } finally {
      db.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("allows an exact configured private origin but rejects other private destinations", async () => {
    const previous = process.env.OPENCODE_ALLOWED_SERVERS
    process.env.OPENCODE_ALLOWED_SERVERS = "http://100.97.224.96:4096"
    try {
      await expect(validateBackendDestination("http://100.97.224.96:4096", { lookup: async () => [{ address: "100.97.224.96", family: 4 }] })).resolves.toBeInstanceOf(URL)
      await expect(validateBackendDestination("http://100.97.224.97:4096", { lookup: async () => [{ address: "100.97.224.97", family: 4 }] })).rejects.toThrow("PRIVATE_NETWORK_NOT_ALLOWED")
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_ALLOWED_SERVERS
      else process.env.OPENCODE_ALLOWED_SERVERS = previous
    }
  })
  test("protects immutable backend identity", () => { const identity = { id: "backend-1", type: "opencode" as const }; expect(() => assertImmutableBackendIdentity(identity, { id: "backend-2" })).toThrow("BACKEND_ID_IMMUTABLE"); expect(() => assertImmutableBackendIdentity(identity, { type: "deepseek-harness" })).toThrow("BACKEND_TYPE_IMMUTABLE") })
  test("recovers an open circuit through a privileged probe", () => { const circuit = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0 }); circuit.failure(true); expect(circuit.canRequest()).toBe(false); expect(circuit.tryRecoveryProbe()).toBe(true); circuit.success(); expect(circuit.canRequest()).toBe(true) })
  test("does not open the circuit for authentication failures", () => { const circuit = new CircuitBreaker({ failureThreshold: 1 }); circuit.failure(false); expect(circuit.snapshot.state).toBe("CLOSED"); expect(circuit.canRequest()).toBe(true) })
  test("permits only one half-open recovery probe", () => { const circuit = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0, halfOpenMaxProbes: 1 }); circuit.failure(true); expect(circuit.tryRecoveryProbe()).toBe(true); expect(circuit.tryRecoveryProbe()).toBe(false); circuit.failure(true); expect(circuit.snapshot.state).toBe("OPEN") })
  test("tracks and bounds subscribers", async () => { const hub = new EventHub(); const received: string[] = []; hub.subscribe((event) => received.push(event.type), { maxPending: 2, overflow: "coalesce-deltas" }); hub.publish({ id: "1", sequence: 1, backendId: "b", backendType: "opencode", sessionId: "s", type: "MESSAGE_DELTA", timestamp: new Date().toISOString() }); await Promise.resolve(); expect(received).toEqual(["MESSAGE_DELTA"]); expect(hub.metrics().subscribers).toBe(1) })
  test("isolates a slow subscriber from a healthy subscriber and preserves ordering", async () => { const hub = new EventHub(); const slow: string[] = []; const healthy: string[] = []; const slowSub = hub.subscribe((event) => slow.push(event.type), { maxPending: 2, overflow: "coalesce-deltas" }); hub.subscribe((event) => healthy.push(event.type)); for (let sequence = 1; sequence <= 5; sequence++) hub.publish({ id: String(sequence), sequence, backendId: "b", backendType: "opencode", sessionId: "s", type: sequence === 5 ? "MESSAGE_END" : "MESSAGE_DELTA", timestamp: new Date().toISOString() }); await new Promise((resolve) => setTimeout(resolve, 0)); expect(healthy).toEqual(["MESSAGE_DELTA", "MESSAGE_DELTA", "MESSAGE_DELTA", "MESSAGE_DELTA", "MESSAGE_END"]); expect(slowSub.metrics().pending).toBeLessThanOrEqual(2); expect(slowSub.metrics().dropped).toBeGreaterThanOrEqual(1); expect(slowSub.metrics().delivered).toBeGreaterThanOrEqual(1); slowSub.unsubscribe(); expect(hub.metrics().subscribers).toBe(1) })
  test("deduplicates sequence numbers and cleans up listener failures", async () => { const hub = new EventHub(); let calls = 0; const sub = hub.subscribe(() => { calls++; throw new Error("listener failed") }); const event = { id: "1", sequence: 1, backendId: "b", backendType: "opencode" as const, sessionId: "s", type: "MESSAGE_END" as const, timestamp: new Date().toISOString() }; expect(hub.publish(event)).toBe(true); expect(hub.publish({ ...event, id: "duplicate" })).toBe(false); await Promise.resolve(); expect(calls).toBe(1); expect(sub.metrics().disconnected).toBe(true); expect(hub.metrics().subscribers).toBe(0) })
  test("retains critical lifecycle events during noncritical overflow", () => { const hub = new EventHub(); const sub = hub.subscribe(() => undefined, { maxPending: 2, overflow: "disconnect" }); const base = { backendId: "b", backendType: "opencode" as const, sessionId: "s", timestamp: new Date().toISOString() }; hub.publish({ ...base, id: "1", sequence: 1, type: "MESSAGE_DELTA" }); hub.publish({ ...base, id: "2", sequence: 2, type: "MESSAGE_DELTA" }); hub.publish({ ...base, id: "3", sequence: 3, type: "SESSION_IDLE" }); expect(sub.metrics().pending).toBe(2); expect(sub.metrics().disconnected).toBe(false) })
  test("clears sequence state when a backend is disposed", () => { const hub = new EventHub(); const base = { backendId: "b", backendType: "opencode" as const, sessionId: "s", timestamp: new Date().toISOString(), type: "MESSAGE_END" as const }; hub.publish({ ...base, id: "1", sequence: 1 }); expect(hub.metrics().sequences).toBe(1); hub.clearBackend("b"); expect(hub.metrics().sequences).toBe(0) })
})
