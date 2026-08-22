import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/RemoteAgentExecution"
const projectID = "proj_remote_agent_exec"
const sessionID = "ses_remote_agent_exec"
const title = "Remote Agent Execution"
const server = `http://100.64.0.10:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.describe("remote-opencode-agent-execution", () => {
  let modelSwitched = false
  let agentSwitched = false
  let providerRuntimeRefreshed = false
  let promptReceived = false

  test.beforeEach(async ({ page }) => {
    modelSwitched = false
    agentSwitched = false
    providerRuntimeRefreshed = false
    promptReceived = false

    await mockOpenCodeServer(page, {
      serverUrl: server,
      protocol: "v2",
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "remote-agent-exec",
        time: { created: 1700000000000, updated: 1700000000000 },
        sandboxes: [],
      },
      provider: {
        all: [
          {
            id: "opencode",
            name: "OpenCode",
            models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
          },
        ],
        connected: ["opencode"],
        default: { providerID: "opencode", modelID: "test" },
      },
      agents: [
        { id: "build", name: "Build", mode: "primary", hidden: false },
        { id: "plan", name: "Plan", mode: "primary", hidden: false },
      ],
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
      onInstanceDispose: () => {
        providerRuntimeRefreshed = true
      },
      onSwitchModel: () => {
        modelSwitched = true
      },
      onSwitchAgent: () => {
        agentSwitched = true
      },
      onPrompt: () => {
        expect(providerRuntimeRefreshed).toBe(true)
        promptReceived = true
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

  test("submits prompt only after backend-owned provider credentials are reloaded", async ({ page }) => {
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const composer = page.locator('[data-component="prompt-input"]')
    await expect(composer).toBeVisible()

    await composer.click()
    await page.keyboard.type("Run build checks")
    const submit = page.getByRole("button", { name: "Send" })
    await submit.click()

    await expect.poll(() => providerRuntimeRefreshed).toBe(true)
    await expect.poll(() => promptReceived).toBe(true)
  })
})
