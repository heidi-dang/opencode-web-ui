export type ControlPlaneServerState = "REGISTERED" | "READY" | "UNHEALTHY" | "AUTH_FAILED"
export type ControlPlaneProtocol = "v1" | "v2"

export type SafeBackendDescriptor = {
  id: string
  type?: string
  name: string
  endpoint: string
  enabled: boolean
  state: ControlPlaneServerState
  protocol?: ControlPlaneProtocol
  capabilities?: Record<string, boolean>
  createdAt?: string
  updatedAt?: string
  lastSeenAt?: string
}

export type ControlPlaneHealthResponse = {
  server: SafeBackendDescriptor
  state: ControlPlaneServerState
  protocol?: ControlPlaneProtocol
  reachable: boolean
  authenticated: boolean
  healthy: boolean
  latencyMs: number
  error?: string
  checkedAt: string
}

export type ControlPlaneRegistrationResponse = {
  server: SafeBackendDescriptor
  ready: boolean
  reachability: "SERVER_READY" | "SERVER_HEALTH_FAILED" | "SERVER_REGISTERED_BUT_UNREACHABLE"
  probe: ControlPlaneHealthResponse
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined
}

function state(value: unknown): ControlPlaneServerState | undefined {
  return value === "REGISTERED" || value === "READY" || value === "UNHEALTHY" || value === "AUTH_FAILED" ? value : undefined
}

function protocol(value: unknown): ControlPlaneProtocol | undefined {
  return value === "v1" || value === "v2" ? value : undefined
}

function fallbackServer(value: Record<string, unknown> | undefined): SafeBackendDescriptor {
  return {
    id: typeof value?.id === "string" ? value.id : "",
    name: typeof value?.name === "string" ? value.name : "Unknown server",
    endpoint: typeof value?.endpoint === "string" ? value.endpoint : "",
    enabled: value?.enabled === true,
    state: state(value?.state) ?? "UNHEALTHY",
    protocol: protocol(value?.protocol),
  }
}

export function parseControlPlaneHealth(value: unknown): ControlPlaneHealthResponse | (Partial<ControlPlaneHealthResponse> & { error: string }) {
  const payload = record(value)
  const server = fallbackServer(record(payload?.server))
  const parsedState = state(payload?.state)
  const parsedProtocol = protocol(payload?.protocol)
  const valid = !!payload
    && !!server.id
    && !!server.endpoint
    && !!parsedState
    && typeof payload.reachable === "boolean"
    && typeof payload.authenticated === "boolean"
    && typeof payload.healthy === "boolean"
    && typeof payload.latencyMs === "number"
    && typeof payload.checkedAt === "string"

  if (!valid) {
    return {
      server,
      state: "UNHEALTHY",
      protocol: parsedProtocol,
      reachable: false,
      authenticated: false,
      healthy: false,
      latencyMs: 0,
      checkedAt: new Date(0).toISOString(),
      error: "CONTROL_PLANE_CONTRACT_INVALID",
    }
  }

  return {
    server,
    state: parsedState,
    protocol: parsedProtocol,
    reachable: payload.reachable as boolean,
    authenticated: payload.authenticated as boolean,
    healthy: payload.healthy as boolean,
    latencyMs: payload.latencyMs as number,
    error: typeof payload.error === "string" ? payload.error : undefined,
    checkedAt: payload.checkedAt as string,
  }
}
