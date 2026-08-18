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

export function normalizedBackendUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined
  try {
    const url = new URL(value)
    url.pathname = url.pathname.replace(/\/$/, "") || "/"
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return undefined
  }
}

export function backendToServerConnection(backend: BootstrapBackend): ServerConnection.Http | undefined {
  const url = normalizedBackendUrl(backend.endpoint)
  if (!url) return undefined
  return {
    type: "http",
    displayName: backend.name,
    http: {
      id: backend.id,
      url,
    },
  }
}

export function bootstrapToServerConnections(response: BootstrapResponse) {
  return (response.backends ?? [])
    .filter((backend) => backend.enabled)
    .map(backendToServerConnection)
    .filter((connection): connection is ServerConnection.Http => !!connection)
}

export function findBootstrapBackend(response: BootstrapResponse, url: string) {
  const normalized = normalizedBackendUrl(url)
  if (!normalized) return undefined
  return (response.backends ?? []).find((backend) => normalizedBackendUrl(backend.endpoint) === normalized)
}

export async function fetchBootstrap(signal?: AbortSignal): Promise<BootstrapResponse> {
  const response = await fetch("/api/bootstrap", { headers: { accept: "application/json" }, signal, cache: "no-store" })
  if (!response.ok) throw new Error(`BOOTSTRAP_HTTP_${response.status}`)
  return response.json() as Promise<BootstrapResponse>
}
