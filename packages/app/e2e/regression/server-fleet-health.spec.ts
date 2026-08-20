import { expect, test } from "@playwright/test"

const server = "http://127.0.0.1:4096"
const serverB = "http://127.0.0.1:4097"

test("server fleet shows health state and search controls", async ({ page }) => {
  await page.addInitScript(({ server, serverB }) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [server] }))
    localStorage.setItem(
      "opencode.global.dat:server.v4",
      JSON.stringify({
        list: [server, serverB].map((url) => ({ type: "http", http: { id: url, url } })),
        projects: {},
        lastProject: {},
        recentlyClosed: {},
      }),
    )
  }, { server, serverB })

  await page.route("**/api/bootstrap", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        backends: [server, serverB].map((endpoint) => ({ id: endpoint, name: endpoint === server ? "Local server" : "Second server", endpoint, enabled: true, state: "READY", protocol: "v1" })),
        activeBackendId: server,
      }),
    }),
  )
  await page.route("**/api/opencode/servers/*/health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        server: { id: server, name: "Local server", endpoint: server, enabled: true, state: "READY", protocol: "v1" },
        state: "READY",
        protocol: "v1",
        reachable: true,
        authenticated: true,
        healthy: true,
        latencyMs: 1,
        checkedAt: new Date().toISOString(),
      }),
    }),
  )
  await page.route("**/api/opencode/**", async (route) => {
    const path = new URL(route.request().url()).pathname.slice("/api/opencode".length) || "/"
    if (/^\/servers\/[^/]+\/health$/.test(path)) return route.fallback()
    if (path === "/global/event" || path === "/event") {
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"id":"evt_server_connected","type":"server.connected","data":{}}\n\n',
      })
    }
    if (path === "/project") return route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
    if (path === "/global/config" || path === "/config" || path.endsWith("/global/config") || path.endsWith("/config"))
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ shells: [] }) })
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  })

  await page.route(`${server}/**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/api/health") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ healthy: true, version: "1.18.18" }),
      })
      return
    }
    if (url.pathname === "/global/config" || url.pathname === "/config") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ shells: [] }) })
      return
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) })
  })

  await page.goto("/")
  await page.getByRole("button", { name: "Settings", exact: true }).click()

  const dialog = page.getByRole("dialog").filter({ hasText: "Servers" }).first()
  await expect(dialog).toBeVisible()
  await dialog.getByRole("tab", { name: "Servers" }).click()
  // TabsV2 renders the settings panel outside the dialog subtree used by the
  // legacy settings locator. The search input is still scoped by its stable
  // accessible name, so use the visible page-level control here.
  const search = page.getByRole("searchbox", { name: /search servers/i })
  await expect(search).toBeVisible()
  await expect(page.getByText("Local server", { exact: true })).toBeVisible()
  await expect(page.getByText("Second server", { exact: true })).toBeVisible()

  await search.fill("missing")
  await expect(page.getByText(/missing/).first()).toBeVisible()
})
