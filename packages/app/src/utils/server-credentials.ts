import { normalizeServerUrl } from "./url-normalize"

const SESSION_PREFIX = "opencode.credentials."
const LEGACY_LOCAL_PREFIX = "opencode.credentials."

function canonicalUrlKey(serverUrl: string): string {
  return normalizeServerUrl(serverUrl) ?? serverUrl.trim()
}

function getSessionStorage() {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null
  } catch {
    return null
  }
}

function getLocalStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null
  } catch {
    return null
  }
}

function sessionKey(serverUrl: string) {
  return `${SESSION_PREFIX}${canonicalUrlKey(serverUrl)}`
}

function legacyLocalKey(serverUrl: string) {
  return `${LEGACY_LOCAL_PREFIX}${canonicalUrlKey(serverUrl)}`
}

function legacyLocalKeys() {
  const ls = getLocalStorage()
  if (!ls) return []
  const keys: string[] = []
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i)
    if (key && key.startsWith(LEGACY_LOCAL_PREFIX)) {
      keys.push(key)
    }
  }
  return keys
}

function migrateLegacyCredentials() {
  const ls = getLocalStorage()
  const ss = getSessionStorage()
  if (!ls || !ss) return
  for (const legacyKey of legacyLocalKeys()) {
    const raw = ls.getItem(legacyKey)
    if (!raw) continue
    const serverUrl = legacyKey.slice(LEGACY_LOCAL_PREFIX.length)
    const sessionKey_ = sessionKey(serverUrl)
    if (!ss.getItem(sessionKey_)) {
      ss.setItem(sessionKey_, raw)
    }
  }
}

function migrateLegacyServerCredentials(knownServers: string[]) {
  const ls = getLocalStorage()
  const ss = getSessionStorage()
  if (!ls || !ss) return
  for (const serverUrl of knownServers) {
    const legacyKey = legacyLocalKey(serverUrl)
    const raw = ls.getItem(legacyKey)
    if (!raw) continue
    const sessionKey_ = sessionKey(serverUrl)
    if (!ss.getItem(sessionKey_)) {
      ss.setItem(sessionKey_, raw)
    }
  }
}

export function saveCredentials(serverUrl: string, username: string | undefined, password: string) {
  if (!password) return
  const data = JSON.stringify({ username, password })
  const ss = getSessionStorage()
  if (ss) {
    ss.setItem(sessionKey(serverUrl), data)
  }
  const ls = getLocalStorage()
  if (ls) {
    ls.setItem(legacyLocalKey(serverUrl), data)
  }
}

export function getCredentials(serverUrl: string): { username?: string; password?: string } | null {
  const key = canonicalUrlKey(serverUrl)
  const ss = getSessionStorage()
  if (ss) {
    const raw = ss.getItem(sessionKey(key))
    if (raw) {
      try {
        return JSON.parse(raw)
      } catch {}
    }
  }
  const ls = getLocalStorage()
  if (ls) {
    const raw = ls.getItem(legacyLocalKey(key))
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (ss) {
          ss.setItem(sessionKey(key), raw)
        }
        return parsed
      } catch {}
    }
  }
  return null
}

export function clearCredentials(serverUrl: string) {
  const ss = getSessionStorage()
  if (ss) {
    ss.removeItem(sessionKey(serverUrl))
  }
  const ls = getLocalStorage()
  if (ls) {
    ls.removeItem(legacyLocalKey(serverUrl))
  }
}

export function hasCredentials(serverUrl: string): boolean {
  return getCredentials(serverUrl) !== null
}

export function runCredentialMigration() {
  migrateLegacyCredentials()
  migrateLegacyServerCredentials([])
}

export namespace CredentialTesting {
  export const SESSION_PREFIX_ = SESSION_PREFIX
  export const LEGACY_LOCAL_PREFIX_ = LEGACY_LOCAL_PREFIX
}
