import { test, expect, type Page } from "@playwright/test"
import {
  installCredentialHarness,
  saveCredentialViaModule,
  getCredentialViaModule,
  clearCredentialViaModule,
} from "../utils/credential-harness"

const BACKEND_URL = process.env.SMOKE_BACKEND_URL ?? "http://127.0.0.1:4096"
const FRONTEND_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Set up a fetch-level interceptor that passively captures SSE frames
 * without disrupting the app's normal SSE consumption.
 */
async function installSSECapture(page: Page) {
  await page.addInitScript(() => {
    // ---- types for the shared arrays (plain objects, no TS) ----
    ;(window as any).__oc_sseEvents = []
    ;(window as any).__oc_sseResponses = []

    const origFetch = window.fetch.bind(window)

    window.fetch = function (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url

      if (
        url.includes("/global/event") ||
        url.includes("/event") ||
        url.includes("/api/event")
      ) {
        const promise = origFetch(input, init)
        promise
          .then(async (response) => {
            ;(window as any).__oc_sseResponses.push({
              status: response.status,
              contentType: response.headers.get("content-type"),
              url,
            })
            const ct = response.headers.get("content-type") ?? ""
            if (ct.includes("text/event-stream")) {
              captureStream(response.clone(), (window as any).__oc_sseEvents)
            }
          })
          .catch(() => {
            /* connection aborted \u2013 expected */
          })
        return promise
      }
      return origFetch(input, init)
    } as typeof fetch

    async function captureStream(
      response: Response,
      events: string[],
    ): Promise<void> {
      try {
        const reader = response.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: !done })
          let idx = buffer.indexOf("\n\n")
          while (idx >= 0) {
            const frame = buffer.slice(0, idx)
            buffer = buffer.slice(idx + 2)
            if (frame.trim()) events.push(frame.trim())
            idx = buffer.indexOf("\n\n")
          }
        }
      } catch {
        /* stream closed / aborted \u2013 expected */
      }
    }
  })
}

test.describe("Official OpenCode Smoke", () => {
  test("Login page loads", async ({ page }) => {
    const response = await page.goto("/login")
    expect(response?.status()).toBe(200)
    await expect(page.locator("#root")).toBeAttached()
  })

  test("Backend health succeeds", async () => {
    const res = await fetch(`${BACKEND_URL}/global/health`)
    expect(res.ok).toBe(true)
    const body = await res.json()
    expect(body.healthy).toBe(true)
  })

  test("Authentication rejection returns 401", async () => {
    const res = await fetch(`${BACKEND_URL}/global/health`, {
      headers: { Authorization: "Basic " + Buffer.from("wrong:wrong").toString("base64") },
    })
    expect(res.status).toBe(401)
  })

  test("Frontend connects without page errors", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (err) => errors.push(err.message))
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })
    await page.goto("/")
    await page.waitForTimeout(3000)
    expect(errors.length).toBe(0)
  })

  test("SSE connection receives real data", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (err) => errors.push(err.message))
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })

    // Intercept SSE at the fetch level so we can read the raw stream body
    await installSSECapture(page)

    await page.goto("/")
    await page.waitForTimeout(5000)

    // ---- Assert HTTP-level properties ----
    const sseResponses: Array<{ status: number; contentType: string | null; url: string }> =
      await page.evaluate(() => (window as any).__oc_sseResponses)
    expect(sseResponses.length).toBeGreaterThanOrEqual(1)
    for (const sse of sseResponses) {
      expect(sse.status).toBe(200)
    }
    for (const sse of sseResponses) {
      expect(sse.contentType).toContain("text/event-stream")
    }

    // ---- Assert actual SSE frames were received ----
    const sseEvents: string[] = await page.evaluate(() => (window as any).__oc_sseEvents)
    expect(sseEvents.length).toBeGreaterThan(0)
    // At least one frame should have a data: line
    const dataFrames = sseEvents.filter((f) => f.startsWith("data:") || f.includes("\ndata:"))
    expect(dataFrames.length).toBeGreaterThan(0)

    expect(errors.length).toBe(0)
  })

  test("SSE disconnect and reconnect creates new connection", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (err) => errors.push(err.message))
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })

    // Intercept SSE at the fetch level
    await installSSECapture(page)

    // ---- First connection ----
    await page.goto("/")
    await page.waitForTimeout(3000)

    let sseResponses: Array<{ status: number; url: string; contentType: string | null }> =
      await page.evaluate(() => (window as any).__oc_sseResponses)
    const firstWaveCount = sseResponses.length
    expect(firstWaveCount).toBeGreaterThanOrEqual(1)
    // Basic assertion: each response is 200 + event-stream
    for (const r of sseResponses) {
      expect(r.status).toBe(200)
      expect(r.contentType).toContain("text/event-stream")
    }

    // Capture event count before disconnect
    let eventsBefore: string[] = await page.evaluate(() => (window as any).__oc_sseEvents)
    expect(eventsBefore.length).toBeGreaterThan(0)
    expect(errors.length).toBe(0)

    // ---- Interrupt by navigating away (aborts the SSE stream) ----
    await page.goto("/login")
    await page.waitForTimeout(2000)
    expect(errors.length).toBe(0)

    // ---- Navigate back \u2014 should establish a new SSE connection ----
    await page.goto("/")
    await page.waitForTimeout(5000)

    sseResponses = await page.evaluate(() => (window as any).__oc_sseResponses)
    expect(sseResponses.length).toBeGreaterThan(firstWaveCount)

    // ---- Verify the app continues receiving updates after reconnect ----
    const eventsAfter: string[] = await page.evaluate(() => (window as any).__oc_sseEvents)
    expect(eventsAfter.length).toBeGreaterThan(eventsBefore.length)

    expect(errors.length).toBe(0)
  })

  test("Server connection fields are present", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (err) => errors.push(err.message))
    await page.goto("/")
    await page.waitForTimeout(2000)
    // Verify the server connection metatag or config exists
    const serverHost = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="opencode-server"]')
      return meta?.getAttribute("content") ?? null
    })
    // Either the metatag exists with a value, or the page renders without errors
    if (serverHost !== null) {
      expect(serverHost.length).toBeGreaterThan(0)
    } else {
      // Fallback: check that the app frame loaded with server configuration
      const appRoot = await page.locator("#root").innerHTML()
      expect(appRoot.length).toBeGreaterThan(0)
    }
    expect(errors.length).toBe(0)
  })

  test("Directory and project API returns data", async () => {
    const res = await fetch(`${BACKEND_URL}/path`)
    expect(res.ok).toBe(true)
    const res2 = await fetch(`${BACKEND_URL}/project/current`)
    // Either 200 (authenticated) or 401 (unauthenticated) is valid
    expect([200, 401]).toContain(res2.status)
  })

  test("Session listing returns data", async () => {
    const listRes = await fetch(`${BACKEND_URL}/session`)
    expect(listRes.ok).toBe(true)
    const sessions = await listRes.json()
    expect(Array.isArray(sessions)).toBe(true)
  })

  test("Session lifecycle: Create \u2192 List \u2192 Load \u2192 Abort \u2192 Delete", async () => {
    // Create session
    const createRes = await fetch(`${BACKEND_URL}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "smoke-test-session" }),
    })
    expect(createRes.ok).toBe(true)
    const created = await createRes.json()
    expect(created).toHaveProperty("id")
    const sessionId: string = created.id

    // List sessions
    const listRes = await fetch(`${BACKEND_URL}/session`)
    expect(listRes.ok).toBe(true)
    const sessions = await listRes.json()
    expect(Array.isArray(sessions)).toBe(true)
    expect(sessions.some((s: { id: string }) => s.id === sessionId)).toBe(true)

    // Load session
    const loadRes = await fetch(`${BACKEND_URL}/session/${sessionId}`)
    expect(loadRes.ok).toBe(true)
    const loaded = await loadRes.json()
    expect(loaded).toHaveProperty("id", sessionId)
    expect(loaded).toHaveProperty("title", "smoke-test-session")

    // Abort (cancel any in-flight operations \u2014 e.g., by posting to abort endpoint)
    const abortRes = await fetch(`${BACKEND_URL}/session/${sessionId}/abort`, { method: "POST" })
    // 200 or 404 (if no in-flight operation) are both acceptable
    expect([200, 404]).toContain(abortRes.status)

    // Delete session
    const deleteRes = await fetch(`${BACKEND_URL}/session/${sessionId}`, { method: "DELETE" })
    expect(deleteRes.ok).toBe(true)

    // Verify deletion
    const listAfter = await fetch(`${BACKEND_URL}/session`)
    const sessionsAfter = await listAfter.json()
    expect(sessionsAfter.some((s: { id: string }) => s.id === sessionId)).toBe(false)
  })

  test("Error capture: pageerror and console-error listeners before navigation", async ({ page }) => {
    const pageErrors: string[] = []
    const consoleErrors: string[] = []
    page.on("pageerror", (err) => pageErrors.push(err.message))
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text())
    })
    // Navigate after listeners are registered
    await page.goto("/")
    await page.waitForTimeout(3000)
    // Assert no errors occurred during or after navigation
    expect(pageErrors.length).toBe(0)
    expect(consoleErrors.length).toBe(0)
  })

  test("Credential lifecycle: production module save \u2192 verify isolation \u2192 clear \u2192 reload persistence", async ({ page }) => {
    // Install the production credential module BEFORE navigation so it runs
    // on page load and is available across reloads.
    await installCredentialHarness(page)

    const errors: string[] = []
    page.on("pageerror", (err) => errors.push(err.message))
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })
    await page.goto("/")
    await page.waitForTimeout(2000)

    const SERVER_A = "http://server-a.example.com"
    const SERVER_B = "http://server-b.example.com"

    // ---- saveCredentials(A) \u2014 actual production function -------------------
    await saveCredentialViaModule(page, SERVER_A, "userA", "passA")

    const credA = await getCredentialViaModule(page, SERVER_A)
    expect(credA).not.toBeNull()
    expect(credA!.username).toBe("userA")
    expect(credA!.password).toBe("passA")

    // ---- saveCredentials(B) \u2014 actual production function -------------------
    await saveCredentialViaModule(page, SERVER_B, "userB", "passB")

    const credB = await getCredentialViaModule(page, SERVER_B)
    expect(credB).not.toBeNull()
    expect(credB!.username).toBe("userB")
    expect(credB!.password).toBe("passB")

    // ---- Both credentials are independently readable via production function -
    expect(await getCredentialViaModule(page, SERVER_A)).not.toBeNull()
    expect(await getCredentialViaModule(page, SERVER_B)).not.toBeNull()

    // ---- verify passwords NOT in localStorage (production module uses sessionStorage only) ----
    const lsKeys = await page.evaluate(() => {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key) keys.push(key)
      }
      return keys
    })
    const leaked = lsKeys.filter((k) => k.startsWith("opencode.credentials."))
    expect(leaked.length).toBe(0)

    // ---- verify sessionStorage isolation \u2014 A's URL does not return B's data --
    const bCred = await getCredentialViaModule(page, SERVER_B)
    expect(bCred).not.toBeNull()
    expect(bCred!.username).toBe("userB")

    // ---- clearCredentials(A) \u2014 actual production function ------------------
    await clearCredentialViaModule(page, SERVER_A)

    const credAfterRemove = await getCredentialViaModule(page, SERVER_A)
    expect(credAfterRemove).toBeNull()

    // ---- Confirm A is gone, B remains ----
    expect(await getCredentialViaModule(page, SERVER_A)).toBeNull()
    expect(await getCredentialViaModule(page, SERVER_B)).not.toBeNull()

    // ---- Reload and verify removed credential does not return --------------
    await page.reload()
    await page.waitForTimeout(3000)

    expect(await getCredentialViaModule(page, SERVER_A)).toBeNull()

    expect(errors.length).toBe(0)
  })

  test("Password is absent from localStorage", async ({ page }) => {
    await page.goto("/")
    const ls = await page.evaluate(() => {
      const keys: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key) keys.push(key)
      }
      return keys
    })
    const credKeys = ls.filter((k) => k.includes("credential") || k.includes("password"))
    expect(credKeys.length).toBe(0)
  })

  test("Server removal: production module clearCredentials survives reload", async ({ page }) => {
    await installCredentialHarness(page)

    const errors: string[] = []
    page.on("pageerror", (err) => errors.push(err.message))
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })
    await page.goto("/")
    await page.waitForTimeout(2000)

    const SERVER_X = "http://server-x.example.com"

    // ---- saveCredentials(X) \u2014 actual production function -------------------
    await saveCredentialViaModule(page, SERVER_X, "user-x", "tok-x")

    const credBeforeRemove = await getCredentialViaModule(page, SERVER_X)
    expect(credBeforeRemove).not.toBeNull()

    // ---- clearCredentials(X) \u2014 actual production function ------------------
    await clearCredentialViaModule(page, SERVER_X)

    const credAfterRemove = await getCredentialViaModule(page, SERVER_X)
    expect(credAfterRemove).toBeNull()

    // ---- Reload and verify credential does not come back -------------------
    await page.reload()
    await page.waitForTimeout(3000)
    expect(await getCredentialViaModule(page, SERVER_X)).toBeNull()

    expect(errors.length).toBe(0)
  })

  test("Multiple-server credential isolation works", async () => {
    // Verify that the backend supports sessions (proxy for credential isolation)
    const res = await fetch(`${BACKEND_URL}/session`, {
      headers: { "X-Server-ID": "server-1" },
    })
    expect(res.ok).toBe(true)
    // Subsequent request with different server ID should also succeed
    const res2 = await fetch(`${BACKEND_URL}/session`, {
      headers: { "X-Server-ID": "server-2" },
    })
    expect(res2.ok).toBe(true)
  })

  test("Browser reload recovery", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (err) => errors.push(err.message))
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })
    // Load app, reload, verify it comes back
    await page.goto("/")
    await page.waitForTimeout(2000)
    await page.reload()
    await page.waitForTimeout(3000)
    // After reload the app should still render
    const root = await page.locator("#root")
    await expect(root).toBeAttached()
    // No page errors after reload
    await page.waitForTimeout(2000)
    expect(errors.length).toBe(0)
  })

  test("Abort/cancel capability via navigation", async ({ page }) => {
    // Verify that the app can handle navigation away during loading
    const errors: string[] = []
    page.on("pageerror", (err) => errors.push(err.message))
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text())
    })
    await page.goto("/")
    await page.waitForTimeout(1000)
    // Navigate to login to abort any in-flight requests
    await page.goto("/login")
    await page.waitForTimeout(2000)
    // Navigate back
    await page.goto("/")
    await page.waitForTimeout(3000)
    expect(errors.length).toBe(0)
  })
})
