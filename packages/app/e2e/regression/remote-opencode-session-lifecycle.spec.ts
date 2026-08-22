import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/RemoteSessionLifecycle"
const projectID = "proj_remote_lifecycle"
const sessionID = "ses_remote_lifecycle"
const title = "Session Lifecycle Flow"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.describe("remote-opencode-session-lifecycle", () => {
  let createdSessions: Array<{ body: unknown }> = []
  let storeSessions: Array<{ id: string; [key: string]: unknown }> = []

  test.beforeEach(async ({ page }) => {
    createdSessions = []
    storeSessions = [
      {
        id: sessionID,
        slug: sessionID,
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ]

    await installSseTransport(page, { server, retry: 50 })

    await mockOpenCodeServer(page, {
      protocol: "v2",
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "remote-lifecycle",
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
      sessions: () => storeSessions,
      onSessionCreate: (input) => {
        createdSessions.push(input)
        const newId = `ses_created_${Date.now()}`
        const newSession = {
          id: newId,
          slug: newId,
          projectID,
          directory,
          title: "Created New Session",
          time: { created: Date.now(), updated: Date.now() },
        }
        storeSessions.push(newSession)
        return newSession
      },
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

  test("loads session and responds to dynamic session rename events", async ({ page }) => {
    const transport = await installSseTransport(page, { server, retry: 50 })
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await transport.waitForConnection()
    await expectSessionTitle(page, title)

    const composer = page.locator('[data-component="prompt-input"]')
    await expect(composer).toBeVisible()

    // Backend renames session
    const updatedTitle = "Refactored Session Title"
    await transport.send({
      directory,
      payload: {
        type: "session.renamed",
        properties: { sessionID, title: updatedTitle },
      },
    })

    await expectSessionTitle(page, updatedTitle)
  })

  test("handles dynamic session creation from the new session action", async ({ page }) => {
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const newSessionButton = page.locator('button[aria-label="New session"], button:has-text("New session")').first()
    await expect(newSessionButton).toBeVisible()
    await newSessionButton.click()

    // Composer is ready for new session
    const composer = page.locator('[data-component="prompt-input"]')
    await expect(composer).toBeVisible()
  })
})
