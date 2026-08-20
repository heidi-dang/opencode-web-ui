import { expect, test, type Page, type Route } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { currentSession } from "../utils/mock-server"

const serverA = "http://127.0.0.1:4096"
const serverB = "http://127.0.0.1:4097"
const sessionA = session("ses_server_a", "C:/server-a", "Server A session")
const sessionB = session("ses_server_b", "/home/server-b", "Server B session")

test("closing the active server's last tab opens the remaining server tab", async ({ page }) => {
  const requests: string[] = []
  await mockServers(page, requests, serverA)
  await page.addInitScript(
    ({ serverA, serverB, sessionA, sessionB }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [serverA, serverB] }))
      localStorage.setItem(
        "opencode.global.dat:server.v4",
        JSON.stringify({
          list: [
            { type: "http", http: { id: serverA, url: serverA } },
            { type: "http", http: { id: serverB, url: serverB } },
          ],
          projects: {},
          lastProject: {},
          recentlyClosed: {},
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([
          { type: "session", server: "http://127.0.0.1:4096", sessionId: sessionA },
          { type: "session", server: serverB, sessionId: sessionB },
        ]),
      )
    },
    { serverA, serverB, sessionA: sessionA.id, sessionB: sessionB.id },
  )
  await page.addInitScript(({ serverA, sessionA }) => {
    localStorage.setItem(
      "opencode.window.browser.dat:tabs.recent",
      JSON.stringify({ key: `${serverA}\n/server/${btoa(serverA).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}/session/${sessionA}` }),
    )
  }, { serverA, sessionA: sessionA.id })

  const hrefA = `/server/${base64Encode(serverA)}/session/${sessionA.id}`
  const hrefB = `/server/${base64Encode(serverB)}/session/${sessionB.id}`
  await page.goto(hrefA)
  await expect(page.getByText(sessionA.title).first()).toBeVisible()

  const tabA = page.locator(`[data-titlebar-tab-slot]:has(a[href="${hrefA}"])`)
  await tabA.locator('[data-slot="tab-close"] button').click()

  await expect(page).toHaveURL(new RegExp(`${hrefB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
  await expect.poll(() => requests.some((url) => url.startsWith(serverB) && url.includes(`/session/${sessionB.id}`))).toBe(true)
  await expect(page.getByText(sessionB.title).first()).toBeVisible()
  const sessionBRequests = requests.filter((url) => url.includes(`/session/${sessionB.id}`))
  expect(sessionBRequests.every((url) => url.startsWith(serverB))).toBe(true)
  expect(
    requests.some((request) => {
      const url = new URL(request)
      return url.origin === serverB && url.searchParams.get("directory") === sessionB.directory
    }),
  ).toBe(true)
})

test("legacy session routes preserve an existing tab's server", async ({ page }) => {
  await mockServers(page, [], serverB)
  await page.addInitScript(
    ({ serverB, sessionB }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [serverB] }))
      localStorage.setItem(
        "opencode.global.dat:server.v4",
        JSON.stringify({
          list: [{ type: "http", http: { id: serverB, url: serverB } }],
          projects: {},
          lastProject: {},
          recentlyClosed: {},
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server: serverB, sessionId: sessionB }]),
      )
    },
    { serverB, sessionB: sessionB.id },
  )

  const hrefB = `/server/${base64Encode(serverB)}/session/${sessionB.id}`
  await page.goto(`/${base64Encode(sessionB.directory)}/session/${sessionB.id}`)
  await expect(page).toHaveURL(new RegExp(`${hrefB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
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

async function mockServers(page: Page, requests: string[], activeBackendId: string) {
  const appPort = new URL(
    process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "4173"}`,
  ).port
  const applicationPorts = new Set([appPort, process.env.PLAYWRIGHT_STABILITY_PORT].filter(Boolean))
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.port === appPort && url.pathname === "/api/bootstrap") {
      return json(route, {
        backends: [serverDescriptor(serverA), serverDescriptor(serverB)],
        activeBackendId,
      })
    }
    if (url.port === appPort && url.pathname === "/api/opencode/servers") {
      return json(route, { servers: [serverDescriptor(serverA), serverDescriptor(serverB)] })
    }
    const appHealth = url.pathname.match(/^\/api\/opencode\/servers\/([^/]+)\/health$/)
    if (url.port === appPort && appHealth) {
      const server = decodeURIComponent(appHealth[1])
      return json(route, {
        server: serverDescriptor(server),
        state: "READY",
        protocol: "v1",
        healthy: true,
        reachable: true,
        authenticated: true,
        latencyMs: 1,
        checkedAt: new Date().toISOString(),
      })
    }
    const gatewayServer = applicationPorts.has(url.port) ? url.searchParams.get("serverId") : undefined
    const upstreamOrigin = gatewayServer ?? url.origin
    if (upstreamOrigin !== serverA && upstreamOrigin !== serverB) return route.fallback()
    const path = url.pathname.startsWith("/api/opencode")
      ? url.pathname.slice("/api/opencode".length) || "/"
      : url.pathname
    requests.push(new URL(`${path}${url.search}`, upstreamOrigin).toString())
    const current = upstreamOrigin === serverA ? sessionA : sessionB
    const directory = url.searchParams.get("directory")
    if (directory && directory !== current.directory) return json(route, { name: "InvalidDirectory" }, 500)
    if (path === "/global/event" || path === "/event" || path === "/api/event")
      return sse(route)
    if (path === "/global/health") return json(route, {}, 404)
    if (path === "/api/health") return json(route, { healthy: true, version: "1.18.18" })
    if (path === "/api/session") return json(route, { data: [currentSession(current)], cursor: {} })
    if (path === "/api/session/active") return json(route, { data: {} })
    if (path === "/session/status") return json(route, {})
    if (path === `/api/session/${current.id}`) return json(route, { data: currentSession(current) })
    if (path === `/api/session/${current.id}/message`) return json(route, { data: [], cursor: {} })
    if (path === `/session/${current.id}`) return json(route, current)
    if (/^\/session\/[^/]+$/.test(path)) return json(route, { name: "NotFoundError" }, 404)
    if (path === `/session/${current.id}/message`) return json(route, [])
    if (/^\/session\/[^/]+\/(children|todo|diff)$/.test(path)) return json(route, [])
    if (["/skill", "/command", "/lsp", "/formatter", "/permission", "/question", "/vcs/diff"].includes(path))
      return json(route, [])
    if (["/global/config", "/config"].includes(path)) return json(route, { shells: [] })
    if (["/provider/auth", "/mcp"].includes(path)) return json(route, {})
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
    name: endpoint === serverA ? "Server A" : "Server B",
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

function sse(route: Route) {
  return route.fulfill({ status: 200, contentType: "text/event-stream", body: ": ok\n\n" })
}
