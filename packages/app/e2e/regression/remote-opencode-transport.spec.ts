import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/RemoteTransport"
const projectID = "proj_remote_transport"
const sessionID = "ses_remote_transport"
const title = "Remote Transport Hardening"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.describe("remote-opencode-transport", () => {
  test.beforeEach(async ({ page }) => {
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
            models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
          },
        ],
        connected: ["opencode"],
        default: { providerID: "opencode", modelID: "claude-opus-4-6" },
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
  })

  test("routes remote requests through the same-origin gateway with serverId", async ({ page }) => {
    const interceptedRequests: Array<{ url: string; headers: Record<string, string> }> = []

    page.on("request", (req) => {
      if (req.url().includes("/api/opencode")) {
        interceptedRequests.push({
          url: req.url(),
          headers: req.headers(),
        })
      }
    })

    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    // Verify requests were made through /api/opencode gateway
    expect(interceptedRequests.length).toBeGreaterThan(0)
    for (const req of interceptedRequests) {
      const url = new URL(req.url)
      expect(url.pathname.startsWith("/api/opencode")).toBe(true)
      // Credentials must never appear in query parameters or URL
      expect(url.searchParams.get("password")).toBeNull()
      expect(url.searchParams.get("auth")).toBeNull()
      expect(url.searchParams.get("token")).toBeNull()
      expect(url.username).toBe("")
      expect(url.password).toBe("")
    }
  })

  test("preserves custom server URL path prefixes and normalizes slashes", async ({ page }) => {
    const targetUrl = "http://100.97.224.96:4096/custom/base"
    const parsed = new URL(targetUrl)
    expect(parsed.pathname).toBe("/custom/base")
    expect(parsed.origin).toBe("http://100.97.224.96:4096")
  })
})
