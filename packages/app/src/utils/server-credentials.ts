const SESSION_PREFIX = "opencode.credentials."
const LEGACY_LOCAL_PREFIX = "opencode.credentials."

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
  return `${SESSION_PREFIX}${serverUrl}`
}

function legacyLocalKey(serverUrl: string) {
  return `${LEGACY_LOCAL_PREFIX}${serverUrl}`
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
    ls.removeItem(legacyKey)
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
    ls.removeItem(legacyKey)
  }
}

export function saveCredentials(serverUrl: string, username: string | undefined, password: string) {
  const ss = getSessionStorage()
  if (!ss) return
  if (!password) return
  migrateLegacyCredentials()
  const data = JSON.stringify({ username, password })
  ss.setItem(sessionKey(serverUrl), data)
}

export function getCredentials(serverUrl: string): { username?: string; password?: string } | null {
  const ss = getSessionStorage()
  if (ss) {
    const raw = ss.getItem(sessionKey(serverUrl))
    if (raw) {
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    }
  }
  const ls = getLocalStorage()
  if (ls) {
    const raw = ls.getItem(legacyLocalKey(serverUrl))
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (ss) {
          ss.setItem(sessionKey(serverUrl), raw)
        }
        ls.removeItem(legacyLocalKey(serverUrl))
        return parsed
      } catch {
        return null
      }
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
