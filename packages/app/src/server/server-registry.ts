import { createHash, randomBytes } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export type ServerState = "REGISTERED" | "READY" | "UNHEALTHY"
export type ServerProtocol = "v1" | "v2"
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
  const fallback = (process.env.OPENCODE_ALLOWED_SERVERS ?? "").split(",").map((value) => value.trim()).filter(Boolean).map((baseUrl) => ({
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

async function load(): Promise<RegistryFile> {
  if (cached) return cached
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
  return (await load()).servers.find((server) => server.id === id)
}

export async function registerServer(input: { name?: string; baseUrl: string; username?: string; password?: string; enabled?: boolean }) {
  const baseUrl = normalizeBaseUrl(input.baseUrl)
  const registry = await load()
  const duplicate = registry.servers.find((server) => server.baseUrl === baseUrl)
  if (duplicate) return duplicate
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
  const registry = await load()
  const index = registry.servers.findIndex((server) => server.id === id)
  if (index === -1) return
  if (registry.servers[index].managed === "config") throw new Error("CONFIG_SERVER_READ_ONLY")
  const next = { ...registry.servers[index], ...input, baseUrl: input.baseUrl ? normalizeBaseUrl(input.baseUrl) : registry.servers[index].baseUrl, updatedAt: new Date().toISOString() }
  const duplicate = registry.servers.find((server, candidate) => candidate !== index && server.baseUrl === next.baseUrl)
  if (duplicate) throw new Error("DUPLICATE_SERVER_URL")
  registry.servers[index] = next
  await persist(registry)
  return next
}

export async function deleteServer(id: string) {
  const registry = await load()
  const server = registry.servers.find((item) => item.id === id)
  if (!server) return false
  if (server.managed === "config") throw new Error("CONFIG_SERVER_READ_ONLY")
  await persist({ version: 1, servers: registry.servers.filter((item) => item.id !== id) })
  return true
}

export type ServerProbeResult = {
  reachable: boolean
  healthy: boolean
  protocol?: ServerProtocol
  state: "READY" | "UNHEALTHY"
  latencyMs: number
  error?: string
}

export async function probeRegisteredServer(server: RegisteredServer, timeoutMs = 5000): Promise<ServerProbeResult> {
  const started = Date.now()
  const base = new URL(server.baseUrl)
  const headers = server.password
    ? { Authorization: `Basic ${Buffer.from(`${server.username || "opencode"}:${server.password}`).toString("base64")}` }
    : undefined
  const probe = async (path: string) => {
    const response = await fetch(new URL(`${base.pathname.replace(/\/$/, "")}${path}`, base.origin), {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`HTTP_${response.status}`)
    const value = (await response.json()) as { healthy?: unknown; pid?: unknown }
    if (typeof value.healthy !== "boolean") throw new Error("INVALID_HEALTH_RESPONSE")
    return value
  }

  try {
    const current = await probe("/api/health")
    if (!current.healthy) return { reachable: true, healthy: false, state: "UNHEALTHY", latencyMs: Date.now() - started, error: "OPENCODE_HEALTH_FAILED" }
    return { reachable: true, healthy: true, protocol: "v2", state: "READY", latencyMs: Date.now() - started }
  } catch {
    try {
      const legacy = await probe("/global/health")
      if (!legacy.healthy) return { reachable: true, healthy: false, state: "UNHEALTHY", latencyMs: Date.now() - started, error: "OPENCODE_HEALTH_FAILED" }
      return { reachable: true, healthy: true, protocol: "v1", state: "READY", latencyMs: Date.now() - started }
    } catch (error) {
      const message = error instanceof Error ? error.message : "GATEWAY_CANNOT_REACH_SERVER"
      return {
        reachable: !message.startsWith("HTTP_") && message !== "INVALID_HEALTH_RESPONSE",
        healthy: false,
        state: "UNHEALTHY",
        latencyMs: Date.now() - started,
        error: message === "INVALID_HEALTH_RESPONSE" ? "PROTOCOL_UNKNOWN" : message.startsWith("HTTP_") ? "OPENCODE_HEALTH_FAILED" : "GATEWAY_CANNOT_REACH_SERVER",
      }
    }
  }
}

export async function updateServerHealth(id: string, health: Pick<RegisteredServer, "state" | "protocol">) {
  const registry = await load()
  const index = registry.servers.findIndex((server) => server.id === id)
  if (index === -1) return
  registry.servers[index] = { ...registry.servers[index], ...health, updatedAt: new Date().toISOString() }
  await persist(registry)
  return registry.servers[index]
}

export function resetRegistryForTests() {
  cached = undefined
}
