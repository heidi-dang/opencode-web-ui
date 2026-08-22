import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/RemoteAgentExecution"
const projectID = "proj_remote_agent_exec"
const sessionID = "ses_remote_agent_exec"
const title = "Remote Agent Execution"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.describe("remote-opencode-flowdeck-agents", () => {
  let promptsReceived: Array<{ sessionID: string; body: unknown }> = []
  let switchedAgents: Array<{ sessionID: string; body: unknown }> = []

  test.beforeEach(async ({ page }) => {
    promptsReceived = []
    switchedAgents = []

    await installSseTransport(page, { server, retry: 20 })

    await mockOpenCodeServer(page, {
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
            models: {
              "build-model": {
                id: "build-model",
                name: "OpenCode Build Model",
                limit: { context: 200_000 },
                variants: ["fast", "precise"],
              },
            },
          },
        ],
        connected: ["opencode"],
        default: { providerID: "opencode", modelID: "build-model" },
      },
      // Backend exposes Heidi as primary, Orchestrator as primary, Build as primary, Plan as primary, and specialist subagents
      agents: [
        { id: "build", name: "build", mode: "primary", hidden: false, description: "Default build agent" },
        { id: "plan", name: "plan", mode: "primary", hidden: false, description: "Plan mode" },
        { id: "heidi", name: "heidi", mode: "primary", hidden: false, description: "Heidi coordinator" },
        { id: "orchestrator", name: "orchestrator", mode: "primary", hidden: false, description: "Orchestrator coordinator" },
        { id: "planner", name: "planner", mode: "subagent", hidden: false, description: "Planner subagent" },
        { id: "architect", name: "architect", mode: "subagent", hidden: false, description: "Architect subagent" },
        { id: "internal-helper", name: "internal-helper", mode: "primary", hidden: true, description: "Hidden agent" },
      ],
      globalConfig: {
        default_agent: "heidi",
        provider: {},
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
      onPrompt: (input) => {
        promptsReceived.push(input)
      },
      onSwitchAgent: (input) => {
        switchedAgents.push(input)
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

  test("discovers FlowDeck agents, selects Heidi by default, and excludes subagents/hidden agents from primary picker", async ({ page }) => {
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const composer = page.locator('[data-component="prompt-input"]')
    await expect(composer).toBeVisible()

    // 1. Verify Heidi is selected by default based on backend default_agent
    const agentButton = page.getByRole("button", { name: "Choose agent" })
    await expect(agentButton).toBeVisible()
    await expect(agentButton).toContainText("heidi")

    // 2. Open agent selector menu
    await agentButton.click()

    // Visible primary agents: heidi, orchestrator, build, plan
    await expect(page.locator('[role="menuitemradio"]').filter({ hasText: "heidi" })).toBeVisible()
    await expect(page.locator('[role="menuitemradio"]').filter({ hasText: "orchestrator" })).toBeVisible()
    await expect(page.locator('[role="menuitemradio"]').filter({ hasText: "build" })).toBeVisible()
    await expect(page.locator('[role="menuitemradio"]').filter({ hasText: "plan" })).toBeVisible()

    // Subagents and hidden agents MUST NOT be in the primary picker
    await expect(page.locator('[role="menuitemradio"]').filter({ hasText: "planner" })).toHaveCount(0)
    await expect(page.locator('[role="menuitemradio"]').filter({ hasText: "architect" })).toHaveCount(0)
    await expect(page.locator('[role="menuitemradio"]').filter({ hasText: "internal-helper" })).toHaveCount(0)

    // 3. Switch to build
    const buildOption = page.locator('[role="menuitemradio"]').filter({ hasText: "build" })
    await buildOption.click()
    await expect.poll(() => switchedAgents.length).toBeGreaterThan(0)
    expect(switchedAgents[switchedAgents.length - 1]!.body).toMatchObject({ agent: "build" })
    await expect(agentButton).toContainText("build")

    // 4. Switch back to heidi
    await agentButton.click()
    const heidiOption = page.locator('[role="menuitemradio"]').filter({ hasText: "heidi" })
    await heidiOption.click()
    await expect.poll(() => switchedAgents.length).toBeGreaterThan(1)
    expect(switchedAgents[switchedAgents.length - 1]!.body).toMatchObject({ agent: "heidi" })
    await expect(agentButton).toContainText("heidi")

    // 5. Submit prompt with Heidi
    await composer.click()
    await page.keyboard.type("Execute Heidi coordination task")
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => promptsReceived.length).toBe(1)
    expect(promptsReceived[0]!.body).toMatchObject({
      prompt: expect.objectContaining({ text: "Execute Heidi coordination task" }),
    })
  })
})
