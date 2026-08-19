import { createHash, randomBytes } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { deletePrimaryBackend, getPrimaryBackend, getPrimaryCredentials, insertPrimaryBackend, isDatabasePrimary, updatePrimaryBackend, updatePrimaryHealth } from "./control-plane/repositories/backend-repository"
import { validateBackendDestination } from "./backend/network"

export type ServerState = "REGISTERED" | "READY" | "UNHEALTHY" | "AUTH_FAILED"
export type ServerProtocol = "v1" | "v2"
export type ServerProbeError =
  | "AUTH_FAILED"
  | "SERVER_NOT_FOUND"
  | "SERVER_DISABLED"
  | "GATEWAY_UNAVAILABLE"
  | "GATEWAY_CANNOT_REACH_SERVER"
  | "DNS_RESOLUTION_FAILED"
  | "CONNECTION_REFUSED"
  | "CONNECT_TIMEOUT"
  | "TLS_ERROR"
  | "OPENCODE_HEALTH_FAILED"
  | "MALFORMED_HEALTH_RESPONSE"
  | "PROTOCOL_UNKNOWN"
export type RegisteredServer = {
  id: string
  name: string
  baseUrl: string
  username?: string
  password?: string
  enabled: boolean
  managed: "config" | "runtime"
  state: ServerState
  protocol?: ServerProtocol
  reachable?: boolean
  authenticated?: boolean
  healthy?: boolean
  latencyMs?: number
  error?: ServerProbeError
  updatedAt: string
}

type RegistryFile = { version: 1; servers: RegisteredServer[] }

const DEFAULT_PATH = join(process.cwd(), ".data", "opencode-servers.json")
const storagePath = () => process.env.OPENCODE_SERVERS_STORE || DEFAULT_PATH

export function normalizeBaseUrl(value: string) {
  const parsed = new URL(value.trim())
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("UNSUPPORTED_URL_SCHEME")
  if (parsed.username || parsed.password || parsed.hash) throw new Error("UNSAFE_SERVER_URL")
  if (!parsed.hostname) throw new Error("INVALID_SERVER_URL")
  parsed.search = ""
  parsed.hash = ""
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/"
  return parsed.toString().replace(/\/$/, "")
}

export function publicServer(server: RegisteredServer) {
  const { password: _password, ...safe } = server
  return safe
}

function configServers(): RegisteredServer[] {
  const raw = process.env.OPENCODE_SERVERS_CONFIG
  const fallback = (process.env.OPENCODE_ALLOWED_SERVERS ?? "").split(",").map((value) => value.trim()).filter((value) => value && value !== "*").map((baseUrl) => ({
    id: `srv_${createHash("sha256").update(baseUrl).digest("hex").slice(0, 16)}`,
    name: new URL(baseUrl).hostname,
    baseUrl,
  }))
  if (!raw) return fallback.map((item) => fromConfig(item))
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) throw new Error("INVALID_SERVER_REGISTRY_CONFIG")
  return parsed.map((item) => {
    if (!item || typeof item !== "object") throw new Error("INVALID_SERVER_REGISTRY_CONFIG")
    const value = item as Record<string, unknown>
    if (typeof value.id !== "string" || typeof value.baseUrl !== "string") throw new Error("INVALID_SERVER_REGISTRY_CONFIG")
    return fromConfig({
      id: value.id,
      baseUrl: value.baseUrl,
      name: typeof value.name === "string" ? value.name : undefined,
      enabled: value.enabled !== false,
      username: typeof value.username === "string" ? value.username : undefined,
      password: typeof value.password === "string" ? value.password : undefined,
    })
  })
}

function fromConfig(value: { id: string; baseUrl: string; name?: string; enabled?: boolean; username?: string; password?: string }): RegisteredServer {
  return {
    id: value.id,
    name: value.name || value.id,
    baseUrl: normalizeBaseUrl(value.baseUrl),
    username: value.username,
    password: value.password,
    enabled: value.enabled !== false,
    managed: "config",
    state: "REGISTERED",
    updatedAt: new Date().toISOString(),
  }
}

let writeQueue = Promise.resolve()
let cached: RegistryFile | undefined
let cachedPath: string | undefined

async function load(): Promise<RegistryFile> {
  const path = storagePath()
  if (cached && cachedPath === path) return cached
  cachedPath = path
  const seeded = configServers()
  try {
    const value = JSON.parse(await readFile(storagePath(), "utf8")) as RegistryFile
    cached = { version: 1, servers: value.version === 1 && Array.isArray(value.servers) ? value.servers : [] }
  } catch {
    cached = { version: 1, servers: [] }
  }
  const byId = new Map(seeded.map((server) => [server.id, server]))
  for (const server of cached.servers) if (!byId.has(server.id)) byId.set(server.id, server)
  cached.servers = [...byId.values()]
  return cached
}

async function persist(value: RegistryFile) {
  cached = value
  writeQueue = writeQueue.then(async () => {
    const path = storagePath()
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 })
    await rename(temp, path)
  })
  await writeQueue
}

export async function listServers() {
  return (await load()).servers
}

export async function getServer(id: string) {
  if (isDatabasePrimary()) { const backend = getPrimaryBackend(id); if (!backend) return undefined; const credentials = getPrimaryCredentials(id); return { id: backend.id, name: backend.name, baseUrl: backend.endpoint, ...credentials, enabled: backend.enabled, managed: "runtime" as const, state: backend.state, protocol: backend.protocol as ServerProtocol | undefined, updatedAt: backend.updatedAt } }
  return (await load()).servers.find((server) => server.id === id)
}

export async function registerServer(input: { name?: string; baseUrl: string; username?: string; password?: string; enabled?: boolean }) {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  if (isDatabasePrimary()) {
    const server: RegisteredServer = { id: `srv_${randomBytes(12).toString("hex")}`, name: input.name?.trim() || new URL(baseUrl).hostname, baseUrl, username: input.username?.trim() || undefined, password: input.password || undefined, enabled: input.enabled !== false, managed: "runtime", state: "REGISTERED", updatedAt: new Date().toISOString() }
    if (!insertPrimaryBackend({ id: server.id, name: server.name, endpoint: server.baseUrl, enabled: server.enabled, username: server.username, password: server.password })) throw new Error("DUPLICATE_SERVER_URL")
    return server
  }
  const registry = await load()
  const duplicate = registry.servers.find((server) => server.baseUrl === baseUrl)
  if (duplicate) {
    if (duplicate.managed === "config") return duplicate
    const refreshed = {
      ...duplicate,
      name: input.name?.trim() || duplicate.name,
      username: input.username?.trim() || undefined,
      password: input.password || undefined,
      enabled: input.enabled !== false,
      state: "REGISTERED" as const,
      protocol: undefined,
      updatedAt: new Date().toISOString(),
    }
    const index = registry.servers.indexOf(duplicate)
    registry.servers[index] = refreshed
    await persist(registry)
    return refreshed
  }
  const server: RegisteredServer = {
    id: `srv_${randomBytes(12).toString("hex")}`,
    name: input.name?.trim() || new URL(baseUrl).hostname,
    baseUrl,
    username: input.username?.trim() || undefined,
    password: input.password || undefined,
    enabled: input.enabled !== false,
    managed: "runtime",
    state: "REGISTERED",
    updatedAt: new Date().toISOString(),
  }
  await persist({ version: 1, servers: [...registry.servers, server] })
  return server
}

export async function updateServer(id: string, input: Partial<Pick<RegisteredServer, "name" | "baseUrl" | "username" | "password" | "enabled">>) {
  if (isDatabasePrimary()) { const updated = updatePrimaryBackend(id, { name: input.name, endpoint: input.baseUrl ? normalizeBaseUrl(input.baseUrl) : undefined, username: input.username, password: input.password, enabled: input.enabled }); if (!updated) return; const current = await getServer(id); return current ? { ...current, ...input, baseUrl: input.baseUrl ? normalizeBaseUrl(input.baseUrl) : current.baseUrl, updatedAt: new Date().toISOString() } : undefined }
  const registry = await load()
  const index = registry.servers.findIndex((server) => server.id === id)
  if (index === -1) return
  if (registry.servers[index].managed === "config") throw new Error("CONFIG_SERVER_READ_ONLY")
  const next = { ...registry.servers[index] }
  if (input.name !== undefined) next.name = input.name
  if (input.baseUrl !== undefined) next.baseUrl = normalizeBaseUrl(input.baseUrl)
  if (input.username !== undefined) next.username = input.username.trim() || undefined
  if (input.password !== undefined) next.password = input.password || undefined
  if (input.enabled !== undefined) next.enabled = input.enabled
  next.state = "REGISTERED"
  next.protocol = undefined
  next.error = undefined
  next.reachable = undefined
  next.authenticated = undefined
  next.healthy = undefined
  next.latencyMs = undefined
  next.updatedAt = new Date().toISOString()
  const duplicate = registry.servers.find((server, candidate) => candidate !== index && server.baseUrl === next.baseUrl)
  if (duplicate) throw new Error("DUPLICATE_SERVER_URL")
  registry.servers[index] = next
  await persist(registry)
  return next
}

export async function deleteServer(id: string) {
  if (isDatabasePrimary()) return deletePrimaryBackend(id)
  const registry = await load()
  const server = registry.servers.find((item) => item.id === id)
  if (!server) return false
  if (server.managed === "config") throw new Error("CONFIG_SERVER_READ_ONLY")
  await persist({ version: 1, servers: registry.servers.filter((item) => item.id !== id) })
  return true
}

export type ServerProbeResult = {
  serverId: string
  reachable: boolean
  authenticated: boolean
  healthy: boolean
  protocol?: ServerProtocol
  state: Extract<ServerState, "READY" | "UNHEALTHY" | "AUTH_FAILED">
  latencyMs: number
  error?: ServerProbeError
}

type ProbeFailure = Exclude<NonNullable<ServerProbeResult["error"]>, "AUTH_FAILED">

function classifyNetworkFailure(error: unknown): ProbeFailure {
  const value = error as { name?: string; code?: string; cause?: { code?: string }; message?: string } | undefined
  const code = value?.code || value?.cause?.code
  const message = value?.message?.toLowerCase() || ""
  if (value?.name === "TimeoutError" || value?.name === "AbortError" || code === "ETIMEDOUT" || message.includes("timed out")) return "CONNECT_TIMEOUT"
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || message.includes("getaddrinfo")) return "DNS_RESOLUTION_FAILED"
  if (code === "ECONNREFUSED" || message.includes("connection refused")) return "CONNECTION_REFUSED"
  if (code === "CERT_HAS_EXPIRED" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || message.includes("certificate") || message.includes("tls")) return "TLS_ERROR"
  return "GATEWAY_CANNOT_REACH_SERVER"
}

type ProbeResponse =
  | { kind: "ok"; healthy: boolean }
  | { kind: "http"; status: number }
  | { kind: "malformed" }
  | { kind: "network"; error: ProbeFailure }

export async function probeRegisteredServer(serverOrId: RegisteredServer | string, timeoutMs = 5000, signal?: AbortSignal): Promise<ServerProbeResult> {
  const started = Date.now()
  const server = typeof serverOrId === "string" ? await getServer(serverOrId) : serverOrId
  const serverId = typeof serverOrId === "string" ? serverOrId : serverOrId.id
  if (!server) {
    return { serverId, reachable: false, authenticated: false, healthy: false, state: "UNHEALTHY", latencyMs: Date.now() - started, error: "SERVER_NOT_FOUND" }
  }
  if (!server.enabled) {
    return { serverId, reachable: false, authenticated: false, healthy: false, state: "UNHEALTHY", latencyMs: Date.now() - started, error: "SERVER_DISABLED" }
  }
  const base = await validateBackendDestination(server.baseUrl)
  const headers = server.password !== undefined
    ? { Authorization: `Basic ${Buffer.from(`${server.username || "opencode"}:${server.password}`).toString("base64")}` }
    : undefined
  const probe = async (path: string): Promise<ProbeResponse> => {
    let response: Response
    try {
      response = await fetch(new URL(`${base.pathname.replace(/\/$/, "")}${path}`, base.origin), {
        headers,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        redirect: "manual",
      })
    } catch (error) {
      return { kind: "network", error: classifyNetworkFailure(error) }
    }
    if (!response.ok) { await response.body?.cancel().catch(() => undefined); return { kind: "http", status: response.status } }
    try {
      const value = (await response.json()) as { healthy?: unknown }
      return typeof value.healthy === "boolean" ? { kind: "ok", healthy: value.healthy } : { kind: "malformed" }
    } catch {
      return { kind: "malformed" }
    } finally {
      await response.body?.cancel().catch(() => undefined)
    }
  }

  const finish = (result: Omit<ServerProbeResult, "serverId" | "latencyMs">): ServerProbeResult => ({
    serverId,
    latencyMs: Date.now() - started,
    ...result,
  })
  const current = await probe("/api/health")
  if (current.kind === "ok") {
    return current.healthy
      ? finish({ reachable: true, authenticated: true, healthy: true, protocol: "v2", state: "READY" })
      : finish({ reachable: true, authenticated: true, healthy: false, state: "UNHEALTHY", error: "OPENCODE_HEALTH_FAILED" })
  }
  if (current.kind === "malformed") return finish({ reachable: true, authenticated: true, healthy: false, state: "UNHEALTHY", error: "MALFORMED_HEALTH_RESPONSE" })
  if (current.kind === "network") return finish({ reachable: false, authenticated: false, healthy: false, state: "UNHEALTHY", error: current.error })
  if (current.status === 401 || current.status === 403) return finish({ reachable: true, authenticated: false, healthy: false, state: "AUTH_FAILED", error: "AUTH_FAILED" })

  const legacy = await probe("/global/health")
  if (legacy.kind === "ok") {
    return legacy.healthy
      ? finish({ reachable: true, authenticated: true, healthy: true, protocol: "v1", state: "READY" })
      : finish({ reachable: true, authenticated: true, healthy: false, state: "UNHEALTHY", error: "OPENCODE_HEALTH_FAILED" })
  }
  if (legacy.kind === "malformed") return finish({ reachable: true, authenticated: true, healthy: false, state: "UNHEALTHY", error: "MALFORMED_HEALTH_RESPONSE" })
  if (legacy.kind === "network") return finish({ reachable: false, authenticated: false, healthy: false, state: "UNHEALTHY", error: legacy.error })
  if (legacy.status === 401 || legacy.status === 403) return finish({ reachable: true, authenticated: false, healthy: false, state: "AUTH_FAILED", error: "AUTH_FAILED" })
  if (current.status === 404 && legacy.status === 404) return finish({ reachable: true, authenticated: true, healthy: false, state: "UNHEALTHY", error: "SERVER_NOT_FOUND" })
  return finish({ reachable: true, authenticated: true, healthy: false, state: "UNHEALTHY", error: "OPENCODE_HEALTH_FAILED" })
}

export async function updateServerHealth(id: string, health: Pick<RegisteredServer, "state" | "protocol"> & Partial<Pick<RegisteredServer, "reachable" | "authenticated" | "healthy" | "latencyMs" | "error">>) {
  if (isDatabasePrimary()) { updatePrimaryHealth(id, health); const current = await getServer(id); return current ? { ...current, ...health, updatedAt: new Date().toISOString() } : undefined }
  const registry = await load()
  const index = registry.servers.findIndex((server) => server.id === id)
  if (index === -1) return
  registry.servers[index] = { ...registry.servers[index], ...health, updatedAt: new Date().toISOString() }
  await persist(registry)
  return registry.servers[index]
}

export function resetRegistryForTests() {
  process.env.CONTROL_PLANE_LEGACY_TEST_MODE = "1"
  cached = undefined
  cachedPath = undefined
}
