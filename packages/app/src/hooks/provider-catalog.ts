import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"

const emptyProviderCatalog: NormalizedProviderListResponse = { all: new Map(), connected: [], default: {} }

export type ProviderQueryStatus = "idle" | "loading" | "ready" | "empty" | "error"

export function resolveProviderQueryState(input: {
  enabled: boolean
  isLoading: boolean
  isSuccess: boolean
  isError: boolean
  data?: NormalizedProviderListResponse
  error?: unknown
}) {
  if (!input.enabled) {
    return { status: "idle" as const, ready: false, providers: emptyProviderCatalog, error: undefined }
  }
  if (input.isError) {
    return { status: "error" as const, ready: false, providers: emptyProviderCatalog, error: input.error }
  }
  if (input.isLoading || !input.isSuccess) {
    return { status: "loading" as const, ready: false, providers: emptyProviderCatalog, error: undefined }
  }
  const providers = input.data ?? emptyProviderCatalog
  return {
    status: providers.all.size === 0 ? ("empty" as const) : ("ready" as const),
    ready: true,
    providers,
    error: undefined,
  }
}

type DirectoryCatalog = {
  ready: boolean
  providers: NormalizedProviderListResponse
}

type ProviderCatalogInput =
  | {
      explicit: true
      directory?: string
      catalog?: DirectoryCatalog
    }
  | {
      explicit: false
      directory?: string
      catalog?: DirectoryCatalog
      global: NormalizedProviderListResponse
    }

export function selectProviderCatalog(input: ProviderCatalogInput) {
  if (input.directory && input.catalog?.ready) return input.catalog.providers
  if (input.explicit) return emptyProviderCatalog
  return input.global
}

export function resolveDefaultModel(
  current: NormalizedProviderListResponse["defaultModel"],
  legacy: string | undefined,
) {
  if (current !== undefined) return current ?? undefined
  if (!legacy) return undefined
  const [providerID, modelID] = legacy.split("/")
  return { providerID, modelID }
}
