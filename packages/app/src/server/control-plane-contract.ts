import type { BackendDescriptor, BackendHealth } from "./backend/domain"
import type { ControlPlaneHealthResponse, ControlPlaneProtocol, ControlPlaneRegistrationResponse, SafeBackendDescriptor } from "@/utils/control-plane-contract"

function safeProtocol(value: string | undefined): ControlPlaneProtocol | undefined {
  return value === "v1" || value === "v2" ? value : undefined
}

export type BackendServerLike = Pick<BackendDescriptor, "id" | "name" | "enabled" | "state"> & {
  type?: string
  endpoint?: string
  baseUrl?: string
  protocol?: string
  capabilities?: Record<string, boolean>
  createdAt?: string
  updatedAt: string
  lastSeenAt?: string
}

export function safeBackendDescriptor(server: BackendServerLike): SafeBackendDescriptor {
  return {
    id: server.id,
    type: server.type || "opencode",
    name: server.name,
    endpoint: server.endpoint || server.baseUrl || "",
    enabled: server.enabled,
    state: server.state,
    protocol: safeProtocol(server.protocol),
    capabilities: server.capabilities,
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
    lastSeenAt: server.lastSeenAt,
  }
}

export function serializeControlPlaneHealth(server: BackendServerLike, health: BackendHealth): ControlPlaneHealthResponse {
  const descriptor = safeBackendDescriptor(server)
  return {
    server: descriptor,
    state: descriptor.state,
    protocol: health.protocol ?? descriptor.protocol,
    reachable: health.reachable,
    authenticated: health.authenticated,
    healthy: health.healthy,
    latencyMs: health.latencyMs,
    error: health.error,
    checkedAt: health.checkedAt,
  }
}

export function serializeRegistration(server: BackendServerLike, health: BackendHealth): ControlPlaneRegistrationResponse {
  const probe = serializeControlPlaneHealth(server, health)
  return {
    server: probe.server,
    ready: probe.healthy && probe.state === "READY",
    reachability: probe.reachable ? (probe.healthy ? "SERVER_READY" : "SERVER_HEALTH_FAILED") : "SERVER_REGISTERED_BUT_UNREACHABLE",
    probe,
  }
}
