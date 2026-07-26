import { describe, it, expect, beforeEach } from "bun:test"
import { saveCredentials, getCredentials, clearCredentials, hasCredentials, CredentialTesting } from "@/utils/server-credentials"

describe("server credentials", () => {
  beforeEach(() => {
    if (typeof sessionStorage !== "undefined") sessionStorage.clear()
    if (typeof localStorage !== "undefined") {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i)
        if (key && key.startsWith(CredentialTesting.LEGACY_LOCAL_PREFIX_)) {
          localStorage.removeItem(key)
        }
      }
    }
  })

  it("stores password in sessionStorage, not localStorage", () => {
    saveCredentials("http://localhost:4096", "opencode", "secret123")
    const ss = sessionStorage.getItem(`${CredentialTesting.SESSION_PREFIX_}http://localhost:4096`)
    expect(ss).not.toBeNull()
    const parsed = JSON.parse(ss!)
    expect(parsed.password).toBe("secret123")
    const ls = localStorage.getItem(`${CredentialTesting.LEGACY_LOCAL_PREFIX_}http://localhost:4096`)
    expect(ls).toBeNull()
  })

  it("retrieves password from sessionStorage", () => {
    saveCredentials("http://server:4096", "admin", "mypassword")
    const creds = getCredentials("http://server:4096")
    expect(creds).not.toBeNull()
    expect(creds!.password).toBe("mypassword")
    expect(creds!.username).toBe("admin")
  })

  it("returns null for unknown server", () => {
    const creds = getCredentials("http://unknown:4096")
    expect(creds).toBeNull()
  })

  it("clears credentials on remove", () => {
    saveCredentials("http://server:4096", "u", "p")
    clearCredentials("http://server:4096")
    const creds = getCredentials("http://server:4096")
    expect(creds).toBeNull()
    const ss = sessionStorage.getItem(`${CredentialTesting.SESSION_PREFIX_}http://server:4096`)
    expect(ss).toBeNull()
  })

  it("migrates legacy localStorage to sessionStorage", () => {
    const legacyKey = `${CredentialTesting.LEGACY_LOCAL_PREFIX_}http://legacy:4096`
    localStorage.setItem(legacyKey, JSON.stringify({ username: "legacy", password: "oldpass" }))
    const creds = getCredentials("http://legacy:4096")
    expect(creds).not.toBeNull()
    expect(creds!.password).toBe("oldpass")
    const ls = localStorage.getItem(legacyKey)
    expect(ls).toBeNull()
    const ss = sessionStorage.getItem(`${CredentialTesting.SESSION_PREFIX_}http://legacy:4096`)
    expect(ss).not.toBeNull()
  })

  it("re-adding same URL does not recover old password", () => {
    saveCredentials("http://same:4096", "u1", "pass1")
    clearCredentials("http://same:4096")
    const creds = getCredentials("http://same:4096")
    expect(creds).toBeNull()
  })

  it("two servers cannot read each other's credentials", () => {
    saveCredentials("http://server-a:4096", "user-a", "pass-a")
    saveCredentials("http://server-b:4096", "user-b", "pass-b")
    const credsA = getCredentials("http://server-a:4096")
    expect(credsA!.password).toBe("pass-a")
    const credsB = getCredentials("http://server-b:4096")
    expect(credsB!.password).toBe("pass-b")
    expect(credsA!.password).not.toBe(credsB!.password)
  })

  it("hasCredentials returns correct state", () => {
    expect(hasCredentials("http://test:4096")).toBe(false)
    saveCredentials("http://test:4096", "u", "p")
    expect(hasCredentials("http://test:4096")).toBe(true)
    clearCredentials("http://test:4096")
    expect(hasCredentials("http://test:4096")).toBe(false)
  })
})
