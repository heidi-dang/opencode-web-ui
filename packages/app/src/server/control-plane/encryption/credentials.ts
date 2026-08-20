import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const VERSION = "v1"
const encryptionDisabled = () => process.env.APP_ENCRYPTION_DISABLED === "1"

function keyFrom(value: string) {
  const key = Buffer.from(value, "base64")
  if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY_MUST_BE_32_BYTES_BASE64")
  return key
}

export function encryptCredential(value: string, secret = process.env.APP_ENCRYPTION_KEY) {
  if (encryptionDisabled()) return value
  if (!secret) throw new Error("APP_ENCRYPTION_KEY_REQUIRED")
  const nonce = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), nonce)
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return `${VERSION}.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`
}

function decryptWithKey(payload: string, secret: string) {
  const [version, nonceRaw, tagRaw, cipherRaw] = payload.split(".")
  if (!payload.includes(".")) return payload
  if (version !== VERSION || !nonceRaw || !tagRaw || !cipherRaw) throw new Error("INVALID_ENCRYPTED_CREDENTIAL")
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(nonceRaw, "base64url"))
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(cipherRaw, "base64url")), decipher.final()]).toString("utf8")
}

export function decryptCredential(payload: string, secret = process.env.APP_ENCRYPTION_KEY) {
  if (encryptionDisabled()) return payload
  const candidates = [secret, secret === process.env.APP_ENCRYPTION_KEY ? process.env.APP_ENCRYPTION_KEY_2 : undefined].filter(
    (value): value is string => Boolean(value),
  )
  if (candidates.length === 0) throw new Error("APP_ENCRYPTION_KEY_REQUIRED")
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      return decryptWithKey(payload, candidate)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error("INVALID_ENCRYPTED_CREDENTIAL")
}
