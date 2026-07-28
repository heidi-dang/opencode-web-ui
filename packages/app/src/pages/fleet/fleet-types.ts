import type { ServerConnection } from "@/context/server"

export type FleetServerState =
  | "checking"
  | "online"
  | "degraded"
  | "offline"
  | "auth-required"
  | "auth-failed"

export type FleetStreamState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"

export interface FleetStreamStatus {
  state: FleetStreamState
  connectedAt?: number
  lastEventAt?: number
  lastErrorAt?: number
  reconnectCount: number
}

export interface FleetServerSnapshot {
  key: ServerConnection.Key
  name: string
  url: string
  label?: string

  connection: {
    type: "http" | "sidecar" | "wsl" | "ssh"
    local: boolean
  }

  health: {
    state: FleetServerState
    healthy?: boolean
    version?: string
    /** Uncached round-trip latency in milliseconds */
    latencyMs?: number
    checkedAt?: number
  }

  protocol: {
    kind?: "v1" | "v2"
  }

  projects: {
    open: number
    known: number
  }

  sessions: {
    running: number
    busy: number
    permissionBlocked: number
    questionBlocked: number
    totalActive: number
  }

  providers: {
    connected: number
    configured: number
  }

  stream: FleetStreamStatus
}

export type FleetSortKey = "name" | "state" | "latency" | "sessions" | "projects"
export type FleetFilterStatus = "all" | "online" | "degraded" | "offline" | "auth-issue"
export type FleetConnectionType = FleetServerSnapshot["connection"]["type"]

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

  /** Refresh a single server (uncached latency probe) */
  readonly refreshOne: (key: ServerConnection.Key) => Promise<void>
  /** Refresh all servers (bounded to 4 concurrent workers) */
  readonly refreshAll: () => Promise<void>
  /** Manually reconnect the event stream for one server */
  readonly reconnectStream: (key: ServerConnection.Key) => void
  /** Open the server in the UI (switch to it) */
  readonly openServer: (key: ServerConnection.Key) => void
  /** Open a project directory on a server */
  readonly openProject: (key: string, directory: string) => void
  /** Open an active session */
  readonly openSession: (key: string, sessionID: string) => void
  /** Edit the server connection in Settings */
  readonly editServer: (key: ServerConnection.Key) => void
  /** Get the server connection object by key */
  readonly getConnection: (key: ServerConnection.Key) => ServerConnection.Any | undefined

  readonly lastRefreshTime: () => number | undefined
  readonly refreshing: () => boolean
  readonly refreshingKeys: () => Set<string>
}

export const HEALTH_CONCURRENCY = 4
export const HEALTH_PROBE_TIMEOUT_MS = 5_000
