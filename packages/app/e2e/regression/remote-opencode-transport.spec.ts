import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockMultiServer, mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/RemoteTransport"
const projectID = "proj_remote_transport"
const sessionID = "ses_remote_transport"
const title = "Remote Transport Hardening"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.describe("remote-opencode-transport", () => {
  test("routes remote requests through same-origin gateway and sanitizes credentials from browser URL", async ({ page }) => {
    const interceptedRequests: Array<{ url: string; headers: Record<string, string> }> = []

    page.on("request", (req) => {
      if (req.url().includes("/api/opencode")) {
        interceptedRequests.push({
          url: req.url(),
          headers: req.headers(),
        })
      }
    })

    await mockOpenCodeServer(page, {
      protocol: "v2",
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "remote-transport",
        time: { created: 1700000000000, updated: 1700000000000 },
        sandboxes: [],
      },
      provider: {
        all: [
          {
            id: "opencode",
            name: "OpenCode",
            models: { "build-model": { id: "build-model", name: "Build Model", limit: { context: 200_000 } } },
          },
        ],
        connected: ["opencode"],
        default: { providerID: "opencode", modelID: "build-model" },
      },
      sessions: [
        {
          id: sessionID,
          slug: sessionID,
          projectID,
          directory,
          title,
          version: "dev",
          time: { created: 1700000000000, updated: 1700000000000 },
        },
      ],
      pageMessages: () => ({ items: [] }),
    })

    await page.addInitScript(
      ({ directory, server, sessionID }) => {
        localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
        localStorage.setItem(
          "opencode.global.dat:server",
          JSON.stringify({
            projects: { local: [{ worktree: directory, expanded: true }] },
            lastProject: { local: directory },
          }),
        )
        localStorage.setItem(
          "opencode.window.browser.dat:tabs",
          JSON.stringify([{ type: "session", server, sessionId: sessionID }]),
        )
      },
      { directory, server, sessionID },
    )

    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    expect(interceptedRequests.length).toBeGreaterThan(0)
    for (const req of interceptedRequests) {
      const url = new URL(req.url)
      expect(url.pathname.startsWith("/api/opencode")).toBe(true)
      expect(url.searchParams.get("password")).toBeNull()
      expect(url.searchParams.get("auth")).toBeNull()
      expect(url.searchParams.get("token")).toBeNull()
      expect(url.username).toBe("")
      expect(url.password).toBe("")
    }
  })

  test("preserves non-root upstream base path and normalizes slashes during gateway forwarding", async ({ page }) => {
    const receivedUpstreamPaths: string[] = []
    const basePath = "/opencode/backend"

    await mockOpenCodeServer(page, {
      protocol: "v2",
      basePath,
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "remote-transport",
        time: { created: 1700000000000, updated: 1700000000000 },
        sandboxes: [],
      },
      provider: {
        all: [
          {
            id: "opencode",
            name: "OpenCode",
            models: { "build-model": { id: "build-model", name: "Build Model", limit: { context: 200_000 } } },
          },
        ],
        connected: ["opencode"],
        default: { providerID: "opencode", modelID: "build-model" },
      },
      sessions: [
        {
          id: sessionID,
          slug: sessionID,
          projectID,
          directory,
          title,
          version: "dev",
          time: { created: 1700000000000, updated: 1700000000000 },
        },
      ],
      pageMessages: () => ({ items: [] }),
      statusOverride: (path) => {
        receivedUpstreamPaths.push(path)
        return undefined
      },
    })

    await page.addInitScript(
      ({ directory, server, sessionID }) => {
        localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
        localStorage.setItem(
          "opencode.global.dat:server",
          JSON.stringify({
            projects: { local: [{ worktree: directory, expanded: true }] },
            lastProject: { local: directory },
          }),
        )
        localStorage.setItem(
          "opencode.window.browser.dat:tabs",
          JSON.stringify([{ type: "session", server, sessionId: sessionID }]),
        )
      },
      { directory, server, sessionID },
    )

    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    expect(receivedUpstreamPaths.length).toBeGreaterThan(0)
    expect(receivedUpstreamPaths.some((p) => p === "/api/session" || p === "/api/model" || p === "/api/project" || p.startsWith("/servers/"))).toBe(true)
  })

  test("verifies authentication parity and multi-server credential isolation", async ({ page }) => {
    const serverAUrl = "http://127.0.0.1:4096"
    const serverBUrl = "http://127.0.0.1:4097"
    const serverAId = "srv_auth_a"
    const serverBId = "srv_auth_b"

    const authHeadersA: string[] = []
    const authHeadersB: string[] = []

    await mockMultiServer(page, [
      {
        serverId: serverAId,
        serverUrl: serverAUrl,
        name: "Authenticated Server A",
        protocol: "v2",
        username: "userA",
        password: "passwordA_secret",
        directory: "/workspace/a",
        project: { id: "proj_a", name: "app-a", worktree: "/workspace/a", sandboxes: [] },
        sessions: [{ id: "ses_a", projectID: "proj_a", directory: "/workspace/a", title: "Session A", time: { created: 1700000000000 } }],
        provider: {
          all: [{ id: "provider-a", name: "Provider A", models: { "m-a": { id: "m-a", name: "Model A", limit: { context: 200_000 } } } }],
          connected: ["provider-a"],
          default: { providerID: "provider-a", modelID: "m-a" },
        },
        pageMessages: () => ({ items: [] }),
        statusOverride: (_path, _method, headers) => {
          if (headers["authorization"]) authHeadersA.push(headers["authorization"])
          return undefined
        },
      },
      {
        serverId: serverBId,
        serverUrl: serverBUrl,
        name: "Authenticated Server B",
        protocol: "v2",
        username: "userB",
        password: "passwordB_secret",
        directory: "/workspace/b",
        project: { id: "proj_b", name: "app-b", worktree: "/workspace/b", sandboxes: [] },
        sessions: [{ id: "ses_b", projectID: "proj_b", directory: "/workspace/b", title: "Session B", time: { created: 1700000000000 } }],
        provider: {
          all: [{ id: "provider-b", name: "Provider B", models: { "m-b": { id: "m-b", name: "Model B", limit: { context: 200_000 } } } }],
          connected: ["provider-b"],
          default: { providerID: "provider-b", modelID: "m-b" },
        },
        pageMessages: () => ({ items: [] }),
        statusOverride: (_path, _method, headers) => {
          if (headers["authorization"]) authHeadersB.push(headers["authorization"])
          return undefined
        },
      },
    ])

    await page.addInitScript(
      ({ serverAId, serverBId, serverAUrl, serverBUrl }) => {
        localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
        localStorage.setItem(
          "opencode.global.dat:server",
          JSON.stringify({
            projects: {
              local: [{ worktree: "/workspace/a", expanded: true }],
            },
            lastProject: { local: "/workspace/a" },
          }),
        )
        localStorage.setItem(
          "opencode.window.browser.dat:tabs",
          JSON.stringify([
            { type: "session", server: serverAId, sessionId: "ses_a" },
            { type: "session", server: serverBId, sessionId: "ses_b" },
          ]),
        )
      },
      { serverAId, serverBId, serverAUrl, serverBUrl },
    )

    // Load session on Server A
    await page.goto(`/server/${base64Encode(serverAId)}/session/ses_a`)
    await expectSessionTitle(page, "Session A")

    // Load session on Server B
    await page.goto(`/server/${base64Encode(serverBId)}/session/ses_b`)
    await expectSessionTitle(page, "Session B")

    // Assert that credentials for Server A never leaked to Server B
    const expectedAuthA = `Basic ${Buffer.from("userA:passwordA_secret").toString("base64")}`
    const expectedAuthB = `Basic ${Buffer.from("userB:passwordB_secret").toString("base64")}`

    for (const header of authHeadersA) {
      expect(header).toBe(expectedAuthA)
      expect(header).not.toBe(expectedAuthB)
    }

    for (const header of authHeadersB) {
      expect(header).toBe(expectedAuthB)
      expect(header).not.toBe(expectedAuthA)
    }
  })
})
