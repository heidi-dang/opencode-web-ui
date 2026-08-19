import { createHash, scryptSync, timingSafeEqual } from "node:crypto"
import type { IncomingHttpHeaders } from "node:http"

type AuthConfig =
  | { mode: "disabled" }
  | { mode: "basic"; username: string; passwordHash: string }
  | { mode: "invalid"; error: string }

function configuredAuth(): AuthConfig {
  const mode = process.env.WEBUI_AUTH_MODE?.trim().toLowerCase()
  if (!mode) return { mode: "disabled" }
  if (mode !== "basic") return { mode: "invalid", error: "WEBUI_AUTH_MODE_INVALID" }
  const username = process.env.WEBUI_AUTH_USERNAME
  const passwordHash = process.env.WEBUI_AUTH_PASSWORD_HASH
  if (!username || !passwordHash) return { mode: "invalid", error: "WEBUI_AUTH_MISCONFIGURED" }
  return { mode: "basic", username, passwordHash }
}

function fixedEqual(left: string, right: string) {
  const a = createHash("sha256").update(left).digest()
  const b = createHash("sha256").update(right).digest()
  return timingSafeEqual(a, b)
}

function decodeHash(value: string) {
  const parts = value.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return undefined
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  const salt = parts[4]
  if (!Number.isInteger(N) || N < 16_384 || N > 1_048_576 || (N & (N - 1)) !== 0) return undefined
  if (!Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 32) return undefined
  if (!/^[A-Za-z0-9._~-]{8,128}$/.test(salt) || !/^[A-Za-z0-9_-]{40,128}$/.test(parts[5])) return undefined
  try {
    return { N, r, p, salt, expected: Buffer.from(parts[5], "base64url") }
  } catch {
    return undefined
  }
}

function basicCredentials(headers: Headers | IncomingHttpHeaders) {
  const value = headers instanceof Headers ? headers.get("authorization") : headers.authorization
  const encoded = Array.isArray(value) ? value[0] : value
  if (!encoded || !/^Basic\s+/i.test(encoded)) return undefined
  try {
    const decoded = Buffer.from(encoded.replace(/^Basic\s+/i, ""), "base64").toString("utf8")
    const separator = decoded.indexOf(":")
    if (separator < 1) return undefined
    return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) }
  } catch {
    return undefined
  }
}

function validPassword(password: string, passwordHash: string) {
  const parsed = decodeHash(passwordHash)
  if (!parsed || parsed.expected.length !== 32) return false
  try {
    const maxmem = Math.max(32 * 1024 * 1024, 256 * parsed.N * parsed.r)
    const actual = scryptSync(password, parsed.salt, parsed.expected.length, { N: parsed.N, r: parsed.r, p: parsed.p, maxmem })
    return timingSafeEqual(actual, parsed.expected)
  } catch {
    return false
  }
}

export function validateWebUIAuthConfiguration() {
  const config = configuredAuth()
  if (config.mode === "invalid") throw new Error(config.error)
  if (config.mode === "basic" && !decodeHash(config.passwordHash)) throw new Error("WEBUI_AUTH_PASSWORD_HASH_INVALID")
  return config
}

export function authorizeWebUIRequest(headers: Headers | IncomingHttpHeaders) {
  const config = configuredAuth()
  if (config.mode === "disabled") return { allowed: true as const }
  if (config.mode === "invalid") return { allowed: false as const, status: 503, error: "AUTH_MISCONFIGURED" }
  const credentials = basicCredentials(headers)
  if (!credentials || !fixedEqual(credentials.username, config.username) || !validPassword(credentials.password, config.passwordHash)) {
    return { allowed: false as const, status: 401, error: "AUTH_REQUIRED" }
  }
  return { allowed: true as const }
}
