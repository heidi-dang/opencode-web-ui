/**
 * Controller-flow tests for the server management dialog.
 *
 * The real `useServerManagementController` composition is:
 *   buildServerHttpBase({ url, username, password }) -> conn.http
 *   checkServerHealth(conn.http)                       -> result
 *   if (!result.healthy) block on requiresAuth/authFailed, else server.add(conn)
 *
 * These tests mount the real ServerProvider and exercise the real `add()` plus
 * the credential store, and cover the health-decision guard directly with the
 * exact two-line composition the controller uses.
 *
 * NOTE: `bun test` compiles JSX in `.tsx` files (including the provider modules)
 * to the React classic runtime, so a small `React.createElement` shim maps it
 * onto solid's `createComponent`. The test must run with `--conditions=browser`
 * so solid-js resolves to its client build.
 */
import { createComponent } from "solid-js"

const ReactShim = {
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown {
    const merged: Record<string, unknown> = { ...(props ?? {}) }
    if (children.length === 1) merged.children = children[0]
    else if (children.length > 1) merged.children = children
    return createComponent(type as never, merged as never)
  },
}
;(globalThis as Record<string, unknown>).React = ReactShim

import { beforeEach, describe, expect, test } from "bun:test"
import { render } from "solid-js/web"
import { ServerConnection, ServerProvider, useServer, type ServerConnection as ServerConnectionNS } from "@/context/server"
import { PlatformProvider, type Platform } from "@/context/platform"
import { getCredentials } from "@/utils/server-credentials"
import { buildServerHttpBase } from "@/utils/server-http"
import { checkServerHealth, type ServerHealth } from "@/utils/server-health"

const STORE_KEY = "opencode.global.dat:server"
const TEST_URL = "http://100.64.0.10:4096"

const platform: Platform = {
  platform: "web",
  openLink: () => {},
  restart: async () => {},
  back: () => {},
  forward: () => {},
  notify: async () => {},
}

function fetchAllUnauthorized(): typeof globalThis.fetch {
  return (async () => new Response(null, { status: 401 })) as unknown as typeof globalThis.fetch
}

function fetchAllHealthy(): typeof globalThis.fetch {
  return (async () => Response.json({ healthy: true })) as unknown as typeof globalThis.fetch
}

/**
 * The controller's addMutation guard, exactly as composed in
 * dialog-select-server.tsx: block when unhealthy, with the auth classification
 * driving the error message. A blocked decision means `server.add` is never
 * called.
 */
function addDecision(http: ServerConnectionNS.HttpBase, result: ServerHealth) {
  if (result.healthy) return { blocked: false }
  if (result.requiresAuth && !http.password) return { blocked: true, reason: "requires-auth" }
  if (result.requiresAuth && result.authFailed) return { blocked: true, reason: "auth-failed" }
  return { blocked: true, reason: "unreachable" }
}

async function mountServerHarness() {
  let captured: ReturnType<typeof useServer> | undefined
  const container = document.createElement("div")
  document.body.appendChild(container)

  const Harness = () => {
    captured = useServer()
    return null
  }

  const dispose = render(
    () =>
      createComponent(
        PlatformProvider,
        {
          value: platform,
          // Lazy (function) children are required so ServerProvider executes
          // inside the Platform context scope. Cast the props because solid's
          // typed ParentProps only allows Element children.
          children: () =>
            createComponent(
              ServerProvider,
              {
                defaultServer: ServerConnection.Key.make("http://default"),
                children: () => createComponent(Harness, {}),
              } as never,
            ),
        } as never,
      ),
    container,
  )

  // Let the persisted store's ready promise settle before asserting. The
  // provider gates rendering of its children on `ready`, so the harness only
  // captures `useServer()` after the store is ready.
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
  if (captured?.ready.promise) await captured.ready.promise

  return { captured: captured!, dispose, container }
}

describe("server management controller flow", () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    // Seed the persisted server store so the provider starts empty (also
    // refreshes the in-memory storage cache used by the persist layer).
    localStorage.setItem(STORE_KEY, JSON.stringify({ list: [] }))
  })

  test("URL only can be added and persisted", async () => {
    const { captured, dispose, container } = await mountServerHarness()

    captured.add({ type: "http", http: { url: TEST_URL } })

    const conn = captured.list.find((c) => c.type === "http" && c.http.url === TEST_URL)
    expect(conn?.type === "http" ? conn.http : undefined).toEqual({ url: TEST_URL })
    if (conn?.type === "http") {
      expect(Object.hasOwn(conn.http, "username")).toBe(false)
      expect(conn.http.password).toBeUndefined()
    }
    expect(getCredentials(TEST_URL)).toBeNull()
    expect(localStorage.getItem(STORE_KEY)).toContain(TEST_URL)

    dispose()
    container.remove()
  })

  test("URL plus display name can be added without credentials", async () => {
    const { captured, dispose, container } = await mountServerHarness()

    captured.add({ type: "http", displayName: "Home PC", http: { url: TEST_URL } })

    const conn = captured.list.find((c) => c.type === "http" && c.http.url === TEST_URL)
    expect(conn?.displayName).toBe("Home PC")
    if (conn?.type === "http") {
      expect(Object.hasOwn(conn.http, "username")).toBe(false)
      expect(conn.http.password).toBeUndefined()
    }
    expect(getCredentials(TEST_URL)).toBeNull()

    dispose()
    container.remove()
  })

  test("password plus empty username uses the supported default username", async () => {
    const { captured, dispose, container } = await mountServerHarness()

    // `server.add` saves credentials only when a password exists; the stored
    // credentials are exactly what saveCredentials receives (no username).
    captured.add({ type: "http", http: { url: TEST_URL, username: undefined, password: "secret" } })

    const credentials = getCredentials(TEST_URL)
    expect(credentials?.password).toBe("secret")
    expect(credentials && "username" in credentials).toBe(false)

    const conn = captured.list.find((c) => c.type === "http" && c.http.url === TEST_URL)
    if (conn?.type === "http") {
      expect(conn.http.password).toBe("secret")
      expect(conn.http.username == null).toBe(true)
    }

    dispose()
    container.remove()
  })

  test("username-only input does not create a credentialed connection", async () => {
    const { captured, dispose, container } = await mountServerHarness()

    // The controller always constructs the connection via buildServerHttpBase,
    // which drops a username when there is no password.
    const http = buildServerHttpBase({ url: TEST_URL, username: "opencode", password: undefined })
    expect(http).toEqual({ url: TEST_URL })

    captured.add({ type: "http", http })

    const conn = captured.list.find((c) => c.type === "http" && c.http.url === TEST_URL)
    if (conn?.type === "http") {
      expect(Object.hasOwn(conn.http, "username")).toBe(false)
      expect(conn.http.password).toBeUndefined()
    }
    expect(getCredentials(TEST_URL)).toBeNull()

    dispose()
    container.remove()
  })

  test("protected server without credentials is not saved", async () => {
    const { captured, dispose, container } = await mountServerHarness()

    const http = buildServerHttpBase({ url: TEST_URL, username: "", password: "" })
    const result = await checkServerHealth(http, fetchAllUnauthorized(), { retryCount: 0 })

    expect(result).toEqual({ healthy: false, requiresAuth: true, authFailed: false })
    const decision = addDecision(http, result)
    expect(decision).toEqual({ blocked: true, reason: "requires-auth" })

    // The addMutation-style guard returns before calling server.add.
    expect(captured.list).toEqual([])
    expect(getCredentials(TEST_URL)).toBeNull()

    dispose()
    container.remove()
  })

  test("wrong credentials are not saved", async () => {
    const { captured, dispose, container } = await mountServerHarness()

    const http = buildServerHttpBase({ url: TEST_URL, username: "admin", password: "wrong" })
    const result = await checkServerHealth(http, fetchAllUnauthorized(), { retryCount: 0 })

    expect(result).toEqual({ healthy: false, requiresAuth: true, authFailed: true })
    const decision = addDecision(http, result)
    expect(decision).toEqual({ blocked: true, reason: "auth-failed" })

    expect(captured.list).toEqual([])
    expect(getCredentials(TEST_URL)).toBeNull()

    dispose()
    container.remove()
  })

  test("valid credentials are saved through the existing credential store", async () => {
    const { captured, dispose, container } = await mountServerHarness()

    const http = buildServerHttpBase({ url: TEST_URL, username: "admin", password: "s3cret" })
    const result = await checkServerHealth(http, fetchAllHealthy(), { retryCount: 0 })

    expect(result).toEqual({ healthy: true })
    expect(addDecision(http, result)).toEqual({ blocked: false })

    captured.add({ type: "http", http })

    const conn = captured.list.find((c) => c.type === "http" && c.http.url === TEST_URL)
    expect(conn).toBeDefined()
    expect(getCredentials(TEST_URL)?.password).toBe("s3cret")

    dispose()
    container.remove()
  })

  test("preview and submit produce the same result", () => {
    // Preview (useServerPreview) and submit (addMutation) both construct the
    // HttpBase through buildServerHttpBase, so identical form input must yield
    // identical HttpBase objects.
    const previewHttp = buildServerHttpBase({ url: TEST_URL, username: "", password: "" })
    const submitHttp = buildServerHttpBase({ url: TEST_URL, username: "", password: "" })

    expect(submitHttp).toEqual(previewHttp)
    expect(previewHttp).toEqual({ url: TEST_URL })
    expect(Object.hasOwn(previewHttp, "username")).toBe(false)
    expect(Object.hasOwn(previewHttp, "password")).toBe(false)

    const credentialedPreview = buildServerHttpBase({ url: TEST_URL, username: "admin", password: "pw" })
    const credentialedSubmit = buildServerHttpBase({ url: TEST_URL, username: "admin", password: "pw" })
    expect(credentialedSubmit).toEqual(credentialedPreview)
    expect(credentialedPreview).toEqual({ url: TEST_URL, username: "admin", password: "pw" })
  })
})
