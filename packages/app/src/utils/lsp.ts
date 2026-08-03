import type { LspStatus } from "@opencode-ai/sdk/v2/client"

/**
 * Type guard for a single LSP status entry. Rejects malformed server data at
 * the store boundary so downstream consumers always see valid LspStatus items.
 */
export function isLspStatus(value: unknown): value is LspStatus {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.root === "string" &&
    (v.status === "connected" || v.status === "error")
  )
}

/**
 * Normalise an unknown LSP status payload (array or keyed record) into a typed
 * LspStatus array, dropping malformed entries.
 */
export function normalizeLspStatusList(input: unknown): LspStatus[] {
  if (input == null) return []
  const items = Array.isArray(input) ? input : Object.values(input as Record<string, unknown>)
  return items.filter(isLspStatus)
}
