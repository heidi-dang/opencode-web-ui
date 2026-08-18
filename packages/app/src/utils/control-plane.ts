import type { BackendDescriptor } from "@/server/backend/domain"
import type { ServerConnection } from "@/context/server"

export type BootstrapResponse = {
  backends: BackendDescriptor[]
  activeBackendId?: string
  recentWorkspaces?: unknown[]
  preferences?: Record<string, unknown>
  runtime?: { controlPlane?: string; generatedAt?: string; latencyMs?: number }
}

export async function fetchBootstrap(signal?: AbortSignal): Promise<BootstrapResponse> {
  const response = await fetch("/api/bootstrap", { signal, headers: { accept: "application/json" } })
  if (!response.ok) throw new Error(`BOOTSTRAP_${response.status}`)
  const value = (await response.json()) as BootstrapResponse
  if (!value || !Array.isArray(value.backends)) throw new Error("INVALID_BOOTSTRAP_RESPONSE")
  return value
}

export function backendToServerConnection(backend: BackendDescriptor): ServerConnection.Http {
  return {
    type: "http",
    displayName: backend.name,
    http: { id: backend.id, url: backend.endpoint },
  }
}

export function bootstrapToServerConnections(value: BootstrapResponse) {
  return value.backends.filter((backend) => backend.enabled).map(backendToServerConnection)
}

export function normalizedBackendUrl(value: string) {
  try {
    const url = new URL(value)
    url.pathname = url.pathname.replace(/\/+$/, "")
    return url.toString().replace(/\/+$/, "")
  } catch {
    return value.replace(/\/+$/, "")
  }
}

export function findBootstrapBackend(value: BootstrapResponse, url: string) {
  const target = normalizedBackendUrl(url)
  return value.backends.find((backend) => normalizedBackendUrl(backend.endpoint) === target)
}
