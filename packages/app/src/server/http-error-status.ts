const CLIENT_ERRORS = new Set(["INVALID_SERVER_URL", "UNSUPPORTED_URL_SCHEME", "UNSAFE_SERVER_URL", "PRIVATE_NETWORK_NOT_ALLOWED", "INVALID_SERVER_REGISTRY_CONFIG"])
const NOT_FOUND_ERRORS = new Set(["SERVER_NOT_FOUND"])
const CONFLICT_ERRORS = new Set(["SERVER_DISABLED", "DUPLICATE_SERVER_URL", "CONFIG_SERVER_READ_ONLY"])
const AUTH_ERRORS = new Set(["AUTH_FAILED", "BACKEND_HTTP_401", "BACKEND_HTTP_403"])
const CIRCUIT_ERRORS = new Set(["BACKEND_CIRCUIT_OPEN"])
const UNAVAILABLE_ERRORS = new Set(["GATEWAY_CANNOT_REACH_SERVER", "DNS_RESOLUTION_FAILED", "CONNECTION_REFUSED", "CONNECT_TIMEOUT", "TLS_ERROR", "UPSTREAM_CONNECTION_FAILED"])

export function controlErrorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  if (CLIENT_ERRORS.has(message)) return 400
  if (NOT_FOUND_ERRORS.has(message)) return 404
  if (CONFLICT_ERRORS.has(message)) return 409
  if (AUTH_ERRORS.has(message)) return 401
  if (CIRCUIT_ERRORS.has(message)) return 503
  if (UNAVAILABLE_ERRORS.has(message)) return 502
  return 500
}
