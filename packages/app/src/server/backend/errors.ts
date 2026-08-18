export type BackendErrorCode = "DNS_RESOLUTION_FAILED" | "CONNECTION_REFUSED" | "CONNECT_TIMEOUT" | "TLS_ERROR" | "AUTH_FAILED" | "BACKEND_HEALTH_FAILED" | "BACKEND_CIRCUIT_OPEN" | "UPSTREAM_CONNECTION_FAILED"

export function classifyBackendError(error: unknown): BackendErrorCode {
  const value = error as { name?: string; code?: string; cause?: { code?: string }; message?: string } | undefined
  const code = value?.code || value?.cause?.code
  const message = value?.message?.toLowerCase() || ""
  if (value?.name === "TimeoutError" || value?.name === "AbortError" || code === "ETIMEDOUT" || message.includes("timed out")) return "CONNECT_TIMEOUT"
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || message.includes("getaddrinfo")) return "DNS_RESOLUTION_FAILED"
  if (code === "ECONNREFUSED" || message.includes("connection refused")) return "CONNECTION_REFUSED"
  if (code === "CERT_HAS_EXPIRED" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || message.includes("certificate") || message.includes("tls")) return "TLS_ERROR"
  return "UPSTREAM_CONNECTION_FAILED"
}
