import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { currentSession } from "../utils/mock-server"

const serverA = "http://127.0.0.1:4096"
const serverB = "http://127.0.0.1:4097"
const sessionA = session("ses_server_a", "C:/server-a", "Server A session")
const sessionB = session("ses_server_b", "/home/server-b", "Server B session")

test("tab busy indicator reflects the tab server's own session status", async ({ page }) => {
  await mockServers(page)
  await page.addInitScript(
    ({ serverA, serverB, sessionA, sessionB }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [serverB] }))
      localStorage.setItem(
        "opencode.global.dat:server.v4",
        JSON.stringify({
          list: [serverA, serverB].map((url) => ({ type: "http", http: { id: url, url } })),
          projects: {},
          lastProject: {},
          recentlyClosed: {},
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([
          { type: "session", server: serverA, sessionId: sessionA },
          { type: "session", server: serverB, sessionId: sessionB },
        ]),
      )
    },
    { serverA, serverB, sessionA: sessionA.id, sessionB: sessionB.id },
  )

  const hrefA = `/server/${base64Encode(serverA)}/session/${sessionA.id}`
  const hrefB = `/server/${base64Encode(serverB)}/session/${sessionB.id}`
  await page.goto(hrefA)
  await expect(page.getByText(sessionA.title).first()).toBeVisible()

  // Session B is busy on server B while server A stays the active server, so the
  // busy indicator must come from the tab server's status, not the active server's.
  const tabB = page.locator(`[data-titlebar-tab-slot]:has(a[href="${hrefB}"])`)
  await expect(tabB.locator('[data-component="session-progress-indicator-v2"]')).toBeVisible()

  const tabA = page.locator(`[data-titlebar-tab-slot]:has(a[href="${hrefA}"])`)
  await expect(tabA.locator("[data-titlebar-tab-title]")).toHaveText(sessionA.title)
  await expect(tabA.locator('[data-component="session-progress-indicator-v2"]')).toHaveCount(0)
})

function session(id: string, directory: string, title: string) {
  return {
    id,
    slug: id,
    projectID: `project-${id}`,
    directory,
    title,
    version: "dev",
    time: { created: 1, updated: 1 },
  }
}

async function mockServers(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/api/bootstrap") {
      return json(route, {
        backends: [serverDescriptor(serverA), serverDescriptor(serverB)],
        activeBackendId: serverA,
      })
    }
    const appPort = new URL(process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "4173"}`).port
    const health = url.port === appPort && url.pathname.match(/^\/api\/opencode\/servers\/([^/]+)\/health$/)
    if (health) {
      const endpoint = decodeURIComponent(health[1]!)
      return json(route, { server: serverDescriptor(endpoint), state: "READY", protocol: "v1", reachable: true, authenticated: true, healthy: true, latencyMs: 1, checkedAt: new Date().toISOString() })
    }
    const appRequest = url.port === appPort && url.pathname.startsWith("/api/opencode")
    const origin = appRequest ? url.searchParams.get("serverId") : url.origin
    const path = appRequest ? url.pathname.slice("/api/opencode".length) || "/" : url.pathname
    if (origin !== serverA && origin !== serverB) return route.fallback()
    const current = origin === serverA ? sessionA : sessionB
    const directory = url.searchParams.get("directory")
    if (directory && directory !== current.directory) return json(route, { name: "InvalidDirectory" }, 500)
    if (path === "/global/event" || path === "/event" || path === "/api/event")
      return sse(route, path === "/api/event")
    if (path === "/global/health") return json(route, {}, 404)
    if (path === "/api/health") return json(route, { pid: 1 })
    if (path === "/api/session/status" || path === "/session/status")
      return json(route, origin === serverB ? { [sessionB.id]: { type: "running" } } : {})
    if (path === "/api/session/active" || path === "/session/active")
      return json(route, { data: origin === serverB ? { [sessionB.id]: { type: "running" } } : {} })
    if (path === "/api/session" || path === "/session" || path === "/session/data")
      return json(route, { data: [currentSession(current)], cursor: {} })
    if (path === `/api/session/${current.id}`) return json(route, { data: currentSession(current) })
    if (path === `/api/session/${current.id}/message`) return json(route, { data: [], cursor: {} })
    if (path === `/session/${current.id}`) return json(route, current)
    if (/^\/session\/[^/]+$/.test(path)) return json(route, { name: "NotFoundError" }, 404)
    if (path === `/session/${current.id}/message` || path === "/session/data/message") return json(route, [])
    if (/^\/session\/[^/]+\/(children|todo|diff)$/.test(path)) return json(route, [])
    if (["/skill", "/command", "/lsp", "/formatter", "/permission", "/question", "/vcs/diff"].includes(path))
      return json(route, [])
    if (["/global/config", "/config", "/provider/auth", "/mcp"].includes(path)) return json(route, {})
    if (path === "/provider")
      return json(route, { all: [], connected: [], default: { providerID: "", modelID: "" } })
    if (path === "/agent") return json(route, [{ name: "build", mode: "primary" }])
    if (path === "/project" || path === "/project/current") {
      const project = {
        id: current.projectID,
        worktree: current.directory,
        vcs: "git",
        time: { created: 1, updated: 1 },
        sandboxes: [],
      }
      return json(route, path === "/project" ? [project] : project)
    }
    if (path === "/path")
      return json(route, {
        state: current.directory,
        config: current.directory,
        worktree: current.directory,
        directory: current.directory,
        home: current.directory,
      })
    if (path === "/api/path")
      return json(route, {
        state: current.directory,
        config: current.directory,
        worktree: current.directory,
        directory: current.directory,
        home: current.directory,
      })
    if (path === "/vcs") return json(route, { branch: "main", default_branch: "main" })
    if (path === "/api/vcs")
      return json(route, {
        location: { directory: current.directory },
        data: { branch: "main", defaultBranch: "main" },
      })
    return json(route, {})
  })
}

function serverDescriptor(endpoint: string) {
  return {
    id: endpoint,
    name: endpoint === serverB ? "Server B" : "Server A",
    endpoint,
    enabled: true,
    state: "READY",
    protocol: "v1",
    health: { healthy: true, reachable: true, authenticated: true },
  }
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  })
}

function sse(route: Route, current: boolean) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: current ? 'data: {"id":"evt_connected","type":"server.connected","data":{}}\n\n' : ": ok\n\n",
  })
}
