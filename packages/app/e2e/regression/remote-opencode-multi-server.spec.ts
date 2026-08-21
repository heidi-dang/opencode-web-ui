import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/MultiServerWorkspace"
const projectID = "proj_multi_server"
const sessionA = "ses_server_a"
const titleA = "Server A Workspace"
const serverA = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.describe("remote-opencode-multi-server", () => {
  test.beforeEach(async ({ page }) => {
    await mockOpenCodeServer(page, {
      protocol: "v2",
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "multi-server-project",
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
          id: sessionA,
          slug: sessionA,
          projectID,
          directory,
          title: titleA,
          version: "dev",
          time: { created: 1700000000000, updated: 1700000000000 },
        },
      ],
      pageMessages: () => ({ items: [] }),
    })

    await page.addInitScript(
      ({ directory, serverA, sessionA }) => {
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
          JSON.stringify([{ type: "session", server: serverA, sessionId: sessionA }]),
        )
      },
      { directory, serverA, sessionA },
    )
  })

  test("loads isolated server workspace with correct scope", async ({ page }) => {
    await page.goto(`/server/${base64Encode(serverA)}/session/${sessionA}`)
    await expectSessionTitle(page, titleA)

    const composer = page.locator('[data-component="prompt-input"]')
    await expect(composer).toBeVisible()
  })
})
