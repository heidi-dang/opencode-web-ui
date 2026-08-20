import { base64Encode } from "@opencode-ai/core/util/encode"
import { expect, test, type Page, type Route } from "@playwright/test"
import { installSseTransport } from "../utils/sse-transport"
import { currentSession } from "../utils/mock-server"

const serverA = "http://127.0.0.1:4096"
const serverB = "http://127.0.0.1:4097"
const directoryA = "C:/server-a"
const directoryB = "/home/server-b"
const sessionA = session("ses_server_a", directoryA, "Server A session")
const childSessionA = { ...session("ses_server_a_child", directoryA, "Server A child session"), parentID: sessionA.id }
const sessionB = session("ses_server_b", directoryB, "Server B session")

test("session settings use the remote server context", async ({ page }) => {
  const permissionRequests: string[] = []
  await mockServers(page, permissionRequests)
  await configureServers(page)

  await page.goto(`/server/${base64Encode(serverB)}/session/${sessionB.id}`)
  await expect(page.getByText(sessionB.title).first()).toBeVisible()
  await page.keyboard.press("Control+,")

  const dialog = page.locator(".settings-v2-dialog")
  const autoAccept = dialog.locator('[data-action="settings-auto-accept-permissions"]')
  const input = autoAccept.getByRole("switch")
  await expect(autoAccept).toBeVisible()
  await expect(input).toBeEnabled()
  permissionRequests.length = 0
  await autoAccept.locator('[data-slot="switch-control"]').click()
  await expect(input).toBeChecked()
  await expect
    .poll(() =>
      permissionRequests.some((request) => {
        const url = new URL(request)
        return url.origin === serverB && url.searchParams.get("directory") === directoryB
      }),
    )
    .toBe(true)
  expect(permissionRequests.every((request) => new URL(request).origin === serverB)).toBe(true)

  await dialog.getByRole("tab", { name: "Models" }).click()
  await expect(dialog.getByRole("switch", { name: "Server B Model" })).toBeEnabled()
  await expect(dialog.getByRole("switch", { name: "Server A Model" })).toHaveCount(0)
})

test("auto-accept responds for an unfocused server session", async ({ page }) => {
  const permissionRequests: string[] = []
  const permissionResponses: PermissionResponse[] = []
  const transport = await installSseTransport<{ directory: string; payload: Record<string, unknown> }>(page, {
    server: serverA,
    retry: 20,
  })
  await mockServers(page, permissionRequests, permissionResponses)
  await configureServers(page, [
    { type: "session", server: serverA, sessionId: sessionA.id },
    { type: "session", server: serverB, sessionId: sessionB.id },
  ])

  const hrefB = `/server/${base64Encode(serverB)}/session/${sessionB.id}`
  await page.goto(`/server/${base64Encode(serverA)}/session/${sessionA.id}`)
  await expect(page.getByText(sessionA.title).first()).toBeVisible()
  await page.keyboard.press("Control+,")
  const autoAccept = page.locator(".settings-v2-dialog").locator('[data-action="settings-auto-accept-permissions"]')
  await autoAccept.locator('[data-slot="switch-control"]').click()
  await expect(autoAccept.getByRole("switch")).toBeChecked()
  await expect
    .poll(() =>
      permissionRequests.some((request) => {
        const url = new URL(request)
        return url.origin === serverA && url.searchParams.get("directory") === directoryA
      }),
    )
    .toBe(true)
  await page.keyboard.press("Escape")

  await page.locator(`[data-titlebar-tab-slot]:has(a[href="${hrefB}"])`).click()
  await expect(page).toHaveURL(new RegExp(`${hrefB.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))
  await expect(page.getByText(sessionB.title).first()).toBeVisible()
  await transport.waitForConnection()

  await transport.send({
    directory: directoryA,
    payload: {
      id: "event-permission-background-a",
      type: "permission.asked",
      properties: {
        id: "permission-background-a",
        sessionID: sessionA.id,
        permission: "bash",
        patterns: ["git status"],
        metadata: {},
        always: [],
      },
    },
  })

  await expect
    .poll(() => permissionResponses)
    .toEqual([
      {
        origin: serverA,
        directory: directoryA,
        sessionID: sessionA.id,
        permissionID: "permission-background-a",
        body: { response: "once" },
      },
    ])

  await transport.send({
    directory: directoryA,
    payload: {
      id: "event-permission-background-a-child",
      type: "permission.asked",
      properties: {
        id: "permission-background-a-child",
        sessionID: childSessionA.id,
        permission: "bash",
        patterns: ["git diff"],
        metadata: {},
        always: [],
      },
    },
  })

  await expect
    .poll(() => permissionResponses)
    .toEqual([
      {
        origin: serverA,
        directory: directoryA,
        sessionID: sessionA.id,
        permissionID: "permission-background-a",
        body: { response: "once" },
      },
      {
        origin: serverA,
        directory: directoryA,
        sessionID: childSessionA.id,
        permissionID: "permission-background-a-child",
        body: { response: "once" },
      },
    ])
})

type PermissionResponse = {
  origin: string
  directory?: string
  sessionID: string
  permissionID: string
  body: unknown
}

async function configureServers(page: Page, tabs: { type: "session"; server: string; sessionId: string }[] = []) {
  await page.addInitScript(
    ({ serverB, tabs }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [serverB] }))
      const servers = Array.from(new Set([serverB, ...tabs.map((tab) => tab.server)]))
      localStorage.setItem(
        "opencode.global.dat:server.v4",
        JSON.stringify({
          list: servers.map((url) => ({ type: "http", http: { id: url, url } })),
          projects: {},
          lastProject: {},
          recentlyClosed: {},
        }),
      )
      localStorage.setItem("opencode.window.browser.dat:tabs", JSON.stringify(tabs))
    },
    { serverB, tabs },
  )
}

async function mockServers(page: Page, permissionRequests: string[], permissionResponses: PermissionResponse[] = []) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/api/bootstrap") {
      return json(route, {
        backends: [serverDescriptor(serverA), serverDescriptor(serverB)],
        activeBackendId: serverB,
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
    const remote = origin === serverB
    const directory = remote ? directoryB : directoryA
    const sessions = remote ? [sessionB] : [sessionA, childSessionA]
    const requestDirectory = url.searchParams.get("directory")
    const response = path.match(/^\/session\/([^/]+)\/permissions\/([^/]+)$/)
    if (route.request().method() === "POST" && response) {
      permissionResponses.push({
        origin,
        directory: requestDirectory ?? undefined,
        sessionID: response[1]!,
        permissionID: response[2]!,
        body: route.request().postDataJSON(),
      })
      return json(route, true)
    }
    if (requestDirectory && requestDirectory !== directory) return json(route, { name: "InvalidDirectory" }, 500)
    if (path === "/global/event" || path === "/event" || path === "/api/event")
      return sse(route)
    if (path === "/global/health") return json(route, { healthy: true })
    if (path === "/api/provider" || path === "/api/model" || path === "/api/agent")
      return json(route, { data: [] })
    if (path === "/api/model/default") return json(route, { data: null })
    if (["/api/command", "/api/reference", "/api/permission/request", "/api/question/request"].includes(path))
      return json(route, { location: { directory }, data: [] })
    if (path === "/api/mcp") return json(route, { location: { directory }, data: [] })
    if (path === "/api/mcp/resource")
      return json(route, { location: { directory }, data: { resources: [], templates: [] } })
    if (path === "/api/project") {
      return json(route, [
        {
          id: remote ? sessionB.projectID : "project-server-a",
          worktree: directory,
          vcs: "git",
          time: { created: 1, updated: 1 },
          sandboxes: [],
        },
      ])
    }
    if (path === "/api/project/current")
      return json(route, { id: remote ? sessionB.projectID : "project-server-a", directory })
    if (path === "/api/session" || path === "/session") return json(route, { data: sessions.map(currentSession), cursor: {} })
    if (path === "/api/session/active" || path === "/session/active") return json(route, { data: {} })
    const currentSessionInfo = sessions.find((session) => path === `/api/session/${session.id}`)
    if (currentSessionInfo) return json(route, { data: currentSession(currentSessionInfo) })
    if (sessions.some((session) => path === `/api/session/${session.id}/message`))
      return json(route, { data: [], cursor: {} })
    const current = sessions.find((session) => path === `/session/${session.id}`)
    if (current) return json(route, current)
    if (/^\/session\/[^/]+$/.test(path)) return json(route, { name: "NotFoundError" }, 404)
    if (/^\/session\/[^/]+\/message$/.test(path)) return json(route, [])
    if (/^\/session\/[^/]+\/(children|todo|diff)$/.test(path)) return json(route, [])
    if (path === "/permission") {
      permissionRequests.push(`${origin}${path}${url.search}`)
      return json(route, [])
    }
    if (["/skill", "/command", "/lsp", "/formatter", "/question", "/vcs/diff", "/pty/shells"].includes(path))
      return json(route, [])
    if (["/global/config", "/config", "/provider/auth", "/mcp"].includes(path)) return json(route, {})
    if (path === "/provider") return json(route, provider(remote ? "server-b" : "server-a"))
    if (path === "/agent") return json(route, [{ name: "build", mode: "primary" }])
    if (path === "/project" || path === "/project/current") {
      const project = {
        id: remote ? sessionB.projectID : "project-server-a",
        worktree: directory,
        vcs: "git",
        time: { created: 1, updated: 1 },
        sandboxes: [],
      }
      return json(route, path === "/project" ? [project] : project)
    }
    if (path === "/path")
      return json(route, {
        state: directory,
        config: directory,
        worktree: directory,
        directory,
        home: directory,
      })
    if (path === "/api/path")
      return json(route, { state: directory, config: directory, worktree: directory, directory, home: directory })
    if (path === "/vcs") return json(route, { branch: "main", default_branch: "main" })
    if (path === "/api/vcs")
      return json(route, { location: { directory }, data: { branch: "main", defaultBranch: "main" } })
    if (path === "/api/pty/shells") return json(route, { location: { directory }, data: [] })
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

function provider(id: string) {
  const name = id === "server-b" ? "Server B" : "Server A"
  return {
    all: [
      {
        id,
        name: `${name} Provider`,
        models: {
          [id]: {
            id,
            name: `${name} Model`,
            family: id,
            release_date: "2026-01-01",
            limit: { context: 200_000 },
          },
        },
      },
    ],
    connected: [id],
    default: { providerID: id, modelID: id },
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
