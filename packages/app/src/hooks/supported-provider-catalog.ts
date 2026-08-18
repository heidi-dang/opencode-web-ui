import type { Accessor } from "solid-js"
import { createMemo } from "solid-js"
import { createQuery } from "@tanstack/solid-query"
import type { IntegrationMethod } from "@opencode-ai/client/promise"
import { useServerSDK } from "@/context/server-sdk"

export type SupportedProviderMethod = Extract<IntegrationMethod, { type: "key" | "oauth" | "env" }>

export type SupportedProviderIntegration = {
  id: string
  name: string
  methods: readonly unknown[]
  connections: readonly unknown[]
}

export type LegacyProviderAuthMethod = {
  type: "api" | "oauth"
  label: string
}

export type SupportedProvider = {
  id: string
  name: string
  methods: SupportedProviderMethod[]
  connections: unknown[]
  connected: boolean
}

export type SupportedProviderCatalog = {
  status: "ready" | "empty"
  providers: SupportedProvider[]
}

export class SupportedProviderCatalogError extends Error {
  readonly code = "SUPPORTED_PROVIDER_CATALOG_INVALID"

  constructor(detail: string) {
    super(`SUPPORTED_PROVIDER_CATALOG_INVALID: ${detail}`)
    this.name = "SupportedProviderCatalogError"
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function normalizeMethod(value: unknown): SupportedProviderMethod | undefined {
  if (!record(value) || (value.type !== "key" && value.type !== "oauth" && value.type !== "env")) return
  if (value.type === "oauth" && typeof value.id !== "string") return
  if (value.type === "env" && !Array.isArray(value.names)) return
  if (value.type === "env" && (value.names as unknown[]).some((name: unknown) => typeof name !== "string")) return
  if (value.type !== "env" && value.label !== undefined && typeof value.label !== "string") return
  return value as SupportedProviderMethod
}

function normalizeIntegration(value: unknown, connected: Set<string>): SupportedProvider {
  if (!record(value) || typeof value.id !== "string") throw new SupportedProviderCatalogError("provider id is missing")
  if (value.name !== undefined && typeof value.name !== "string")
    throw new SupportedProviderCatalogError(`provider ${value.id} has an invalid name`)
  if (!Array.isArray(value.methods)) throw new SupportedProviderCatalogError(`provider ${value.id} has no methods`)
  if (value.connections !== undefined && !Array.isArray(value.connections))
    throw new SupportedProviderCatalogError(`provider ${value.id} has invalid connections`)
  const methods = value.methods.map(normalizeMethod)
  if (methods.some((method) => method === undefined))
    throw new SupportedProviderCatalogError(`provider ${value.id} has an invalid authentication method`)
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name.trim() ? value.name : value.id,
    methods: methods as SupportedProviderMethod[],
    connections: (value.connections as unknown[] | undefined) ?? [],
    connected: connected.has(value.id),
  }
}

export function normalizeSupportedProviderCatalog(
  input: readonly SupportedProviderIntegration[] | Record<string, readonly LegacyProviderAuthMethod[]>,
  connectedIDs: readonly string[] = [],
): SupportedProviderCatalog {
  const connected = new Set(connectedIDs)
  if (Array.isArray(input)) {
    for (const value of input) {
      if (record(value) && typeof value.id === "string" && Array.isArray(value.connections) && value.connections.length > 0)
        connected.add(value.id)
    }
  }
  const values: SupportedProviderIntegration[] = Array.isArray(input)
    ? input
    : Object.entries(input).map(([id, methods]) => ({
        id,
        name: id,
        connections: [],
        methods: methods.map((method: LegacyProviderAuthMethod) => ({
          type: method.type === "api" ? "key" : "oauth",
          ...(method.type === "oauth" ? { id: `${id}-oauth` } : {}),
          label: method.label,
        })),
      }))
  const providers = values.map((value) => normalizeIntegration(value, connected))
  providers.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  return { status: providers.length ? "ready" : "empty", providers }
}

export function providerSearchText(provider: Pick<SupportedProvider, "id" | "name">) {
  return `${provider.id} ${provider.name}`.toLowerCase()
}

export function useSupportedProviders(directory?: Accessor<string | undefined>) {
  const serverSDK = useServerSDK()
  const source = createMemo(() => ({
    scope: serverSDK().scope,
    directory: directory?.(),
  }))
  const query = createQuery(() => ({
    queryKey: [source().scope, source().directory, "supported-providers"] as const,
    queryFn: async () => {
      const value = source().directory
      const result = await serverSDK().api.integration.list({
        location: value ? { directory: value } : undefined,
      })
      return normalizeSupportedProviderCatalog(result.data)
    },
  }))
  const status = createMemo<"idle" | "loading" | "ready" | "empty" | "error">(() => {
    if (query.isLoading) return "loading"
    if (query.isError) return "error"
    return query.data?.status ?? "idle"
  })
  return {
    status,
    loading: () => query.isLoading,
    error: () => query.error,
    providers: () => query.data?.providers ?? [],
    refresh: query.refetch,
  }
}
