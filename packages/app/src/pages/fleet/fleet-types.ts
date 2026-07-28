import type { ServerConnection } from "@/context/server"
import type { ServerHealth } from "@/utils/server-health"

export type FleetServerState =
  | "checking"
  | "online"
  | "degraded"
  | "offline"
  | "auth-required"
  | "auth-failed"

export type FleetConnectionType = "http" | "sidecar" | "wsl" | "ssh"

export interface FleetServerSnapshot {
  key: ServerConnection.Key
  name: string
  url: string
  label?: string
  connectionType: FleetConnectionType
  health: {
    state: FleetServerState
    healthy?: boolean
    version?: string
    latencyMs?: number
    checkedAt?: number
  }
  protocol: {
    kind?: "v1" | "v2"
  }
  projects: { open: number; known: number }
  sessions: {
    running: number
    busy: number
    permissionBlocked: number
    questionBlocked: number
    totalActive: number
  }
  providers: { connected: number; configured: number }
}

export type FleetSortKey = "name" | "state" | "latency" | "sessions" | "projects" | "updated"
export type FleetFilterStatus = "all" | "online" | "degraded" | "offline" | "auth-issue"

export interface FleetController {
  readonly servers: () => FleetServerSnapshot[]
  readonly summary: () => {
    online: number
    degraded: number
    offline: number
    totalRunningSessions: number
    totalBlockedSessions: number
    totalServers: number
  }
  readonly search: (query: string) => FleetServerSnapshot[]
  readonly filterByStatus: (list: FleetServerSnapshot[], status: FleetFilterStatus) => FleetServerSnapshot[]
  readonly filterByType: (list: FleetServerSnapshot[], type: FleetConnectionType | "all") => FleetServerSnapshot[]
  readonly sort: (list: FleetServerSnapshot[], key: FleetSortKey) => FleetServerSnapshot[]
  readonly refreshOne: (key: ServerConnection.Key) => Promise<void>
  readonly refreshAll: () => Promise<void>
  openHandler: ((key: ServerConnection.Key) => void) | undefined
  editHandler: ((key: ServerConnection.Key) => void) | undefined
  readonly openServer: (key: ServerConnection.Key) => void
  readonly editServer: (key: ServerConnection.Key) => void
  readonly getConnection: (key: ServerConnection.Key) => ServerConnection.Any | undefined
  readonly lastRefreshTime: () => number | undefined
  readonly refreshing: () => boolean
  readonly refreshingKeys: () => Set<ServerConnection.Key>
  readonly pollingInterval: () => number
}

export const HEALTH_CONCURRENCY = 4
export const HEALTH_PROBE_TIMEOUT_MS = 5_000
export const POLL_INTERVAL_MS = 30_000

/** Normalize connection type — sidecar+variant=wsl → wsl */
export function normalizeConnectionType(conn: ServerConnection.Any): FleetConnectionType {
  if (conn.type === "http") return "http"
  if (conn.type === "sidecar") {
    return (conn as { variant?: string }).variant === "wsl" ? "wsl" : "sidecar"
  }
  if (conn.type === "ssh") return "ssh"
  return "http"
}
