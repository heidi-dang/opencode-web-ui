import type { ServerConnection } from "@/context/server"

export type BootstrapBackend = {
  id: string
  name?: string
  endpoint: string
  enabled: boolean
  health?: { healthy: boolean; reachable: boolean; checkedAt?: number }
}

export type BootstrapResponse = {
  backends?: BootstrapBackend[]
  activeBackendId?: string
  projects?: unknown
  recent?: unknown
}

export function normalizedBackendUrl(value: string) {
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/$/, "") || "/"
  url.search = ""
  url.hash = ""
  return url.toString()
}

export function backendToServerConnection(backend: BootstrapBackend): ServerConnection.Http {
  return {
    type: "http",
    displayName: backend.name,
    http: {
      id: backend.id,
      url: normalizedBackendUrl(backend.endpoint),
    },
  }
}

export function bootstrapToServerConnections(response: BootstrapResponse) {
  return (response.backends ?? []).filter((backend) => backend.enabled).map(backendToServerConnection)
}

export function findBootstrapBackend(response: BootstrapResponse, url: string) {
  const normalized = normalizedBackendUrl(url)
  return (response.backends ?? []).find((backend) => normalizedBackendUrl(backend.endpoint) === normalized)
}

export async function fetchBootstrap(signal?: AbortSignal): Promise<BootstrapResponse> {
  const response = await fetch("/api/bootstrap", { headers: { accept: "application/json" }, signal, cache: "no-store" })
  if (!response.ok) throw new Error(`BOOTSTRAP_HTTP_${response.status}`)
  return response.json() as Promise<BootstrapResponse>
}
