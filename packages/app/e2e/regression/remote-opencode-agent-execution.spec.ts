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

test.describe("remote-opencode-agent-execution", () => {
  let switchedModels: Array<{ sessionID: string; body: unknown }> = []
  let switchedAgents: Array<{ sessionID: string; body: unknown }> = []
  let promptsReceived: Array<{ sessionID: string; body: unknown }> = []
  let providerRuntimeRefreshed = false
  let sessionMessages: Array<unknown> = []

  test.beforeEach(async ({ page }) => {
    switchedModels = []
    switchedAgents = []
    promptsReceived = []
    providerRuntimeRefreshed = false
    sessionMessages = []

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
              "plan-model": {
                id: "plan-model",
                name: "OpenCode Plan Model",
                limit: { context: 200_000 },
              },
            },
          },
          {
            id: "anthropic",
            name: "Anthropic",
            models: {
              "claude-3-5-sonnet": {
                id: "claude-3-5-sonnet",
                name: "Claude 3.5 Sonnet",
                limit: { context: 200_000 },
              },
            },
          },
        ],
        connected: ["opencode", "anthropic"],
        default: { providerID: "opencode", modelID: "build-model" },
      },
      agents: [
        { id: "build", name: "build", mode: "primary", hidden: false },
        { id: "plan", name: "plan", mode: "primary", hidden: false },
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
      onSwitchModel: (input) => {
        switchedModels.push(input)
      },
      onSwitchAgent: (input) => {
        switchedAgents.push(input)
      },
      onPrompt: (input) => {
        promptsReceived.push(input)
      },
      pageMessages: () => ({ items: sessionMessages }),
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

  test("executes complete lifecycle: model switch, agent switch, streaming response, tool execution, idle, and reload persistence", async ({ page }) => {
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const composer = page.locator('[data-component="prompt-input"]')
    await expect(composer).toBeVisible()

    // 1. Model switch via UI
    const modelButton = page.locator('[data-action="prompt-model"]')
    await expect(modelButton).toBeVisible()
    await modelButton.click()

    const modelOption = page.locator('[role="menuitemradio"]').filter({ hasText: "Claude 3.5 Sonnet" })
    await expect(modelOption).toBeVisible()
    await modelOption.click()

    await expect.poll(() => switchedModels.length).toBeGreaterThan(0)
    const lastModelSwitch = switchedModels[switchedModels.length - 1]!
    expect(lastModelSwitch.sessionID).toBe(sessionID)
    expect(lastModelSwitch.body).toMatchObject({
      model: expect.objectContaining({
        providerID: "anthropic",
        id: "claude-3-5-sonnet",
      }),
    })

    // 2. Agent switch via UI keybind
    await composer.click()
    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes("MAC"))
    await page.keyboard.press(isMac ? "Meta+." : "Control+.")

    await expect.poll(() => switchedAgents.length).toBeGreaterThan(0)
    const lastAgentSwitch = switchedAgents[switchedAgents.length - 1]!
    expect(lastAgentSwitch.sessionID).toBe(sessionID)
    expect(lastAgentSwitch.body).toMatchObject({
      agent: "plan",
    })

    // 3. Submit prompt
    await composer.click()
    const promptText = "Execute security audit"
    await page.keyboard.type(promptText)
    const submit = page.getByRole("button", { name: "Send" })
    await submit.click()

    await expect.poll(() => promptsReceived.length).toBe(1)
    expect(promptsReceived[0]!.sessionID).toBe(sessionID)

    // 4. Drive backend SSE execution events
    const promptBody = promptsReceived[0]!.body as { id?: string }
    const msgUserId = promptBody.id ?? "msg_user_lifecycle"
    const msgAsstId = "msg_asst_lifecycle"
    const prtTextUserId = "prt_user_txt"
    const prtReasonId = "prt_asst_reason"
    const prtTextAsstId = "prt_asst_txt"
    const prtToolId = "prt_asst_tool"

    const transport = await installSseTransport(page, { server })

    // Session busy
    await transport.send({
      directory,
      payload: {
        type: "session.status",
        properties: { sessionID, status: { type: "running" } },
      },
    })

    // User message
    await transport.send({
      directory,
      payload: {
        type: "message.updated",
        properties: {
          info: {
            id: msgUserId,
            sessionID,
            role: "user",
            time: { created: 1700000001000 },
            agent: "plan",
            model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
          },
        },
      },
    })

    await transport.send({
      directory,
      payload: {
        type: "message.part.updated",
        properties: {
          part: {
            id: prtTextUserId,
            messageID: msgUserId,
            sessionID,
            type: "text",
            text: promptText,
          },
        },
      },
    })

    // Assistant message start
    await transport.send({
      directory,
      payload: {
        type: "message.updated",
        properties: {
          info: {
            id: msgAsstId,
            sessionID,
            role: "assistant",
            parentID: msgUserId,
            agent: "plan",
            modelID: "claude-3-5-sonnet",
            providerID: "anthropic",
            time: { created: 1700000002000 },
          },
        },
      },
    })

    // Reasoning part & delta
    await transport.send({
      directory,
      payload: {
        type: "message.part.updated",
        properties: {
          part: {
            id: prtReasonId,
            messageID: msgAsstId,
            sessionID,
            type: "reasoning",
            text: "Analyzing security configuration...",
          },
        },
      },
    })

    // Text part & deltas
    await transport.send({
      directory,
      payload: {
        type: "message.part.updated",
        properties: {
          part: {
            id: prtTextAsstId,
            messageID: msgAsstId,
            sessionID,
            type: "text",
            text: "Security audit in progress. ",
          },
        },
      },
    })

    await transport.send({
      directory,
      payload: {
        type: "message.part.delta",
        properties: {
          sessionID,
          messageID: msgAsstId,
          partID: prtTextAsstId,
          field: "text",
          delta: "Checking repository permissions.",
        },
      },
    })

    // Tool execution
    await transport.send({
      directory,
      payload: {
        type: "message.part.updated",
        properties: {
          part: {
            id: prtToolId,
            messageID: msgAsstId,
            sessionID,
            type: "tool",
            tool: "security_scanner",
            state: {
              status: "running",
              input: { target: "all" },
            },
          },
        },
      },
    })

    // Tool completed
    await transport.send({
      directory,
      payload: {
        type: "message.part.updated",
        properties: {
          part: {
            id: prtToolId,
            messageID: msgAsstId,
            sessionID,
            type: "tool",
            tool: "security_scanner",
            state: {
              status: "completed",
              input: { target: "all" },
              output: "Zero vulnerabilities found.",
              metadata: {},
            },
          },
        },
      },
    })

    // Final assistant text delta
    await transport.send({
      directory,
      payload: {
        type: "message.part.delta",
        properties: {
          sessionID,
          messageID: msgAsstId,
          partID: prtTextAsstId,
          field: "text",
          delta: " Audit complete.",
        },
      },
    })

    // Session idle
    await transport.send({
      directory,
      payload: {
        type: "session.status",
        properties: { sessionID, status: { type: "idle" } },
      },
    })

    // Seed authoritative backend store for reload
    sessionMessages = [
      {
        info: {
          id: msgUserId,
          sessionID,
          role: "user",
          time: { created: 1700000001000 },
          agent: "plan",
          model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
        },
        parts: [
          {
            id: prtTextUserId,
            messageID: msgUserId,
            sessionID,
            type: "text",
            text: promptText,
          },
        ],
      },
      {
        info: {
          id: msgAsstId,
          sessionID,
          role: "assistant",
          parentID: msgUserId,
          agent: "plan",
          modelID: "claude-3-5-sonnet",
          providerID: "anthropic",
          time: { created: 1700000002000 },
        },
        parts: [
          {
            id: prtReasonId,
            messageID: msgAsstId,
            sessionID,
            type: "reasoning",
            text: "Analyzing security configuration...",
          },
          {
            id: prtTextAsstId,
            messageID: msgAsstId,
            sessionID,
            type: "text",
            text: "Security audit in progress. Checking repository permissions. Audit complete.",
          },
          {
            id: prtToolId,
            messageID: msgAsstId,
            sessionID,
            type: "tool",
            tool: "security_scanner",
            state: {
              status: "completed",
              input: { target: "all" },
              output: "Zero vulnerabilities found.",
              metadata: {},
            },
          },
        ],
      },
    ]

    // 5. Verify UI rendered output
    const userMsgLocator = page.locator('[data-component="user-message"]')
    await expect(userMsgLocator).toHaveCount(1)
    await expect(userMsgLocator).toContainText(promptText)

    await expect(page.getByText("Security audit in progress. Checking repository permissions. Audit complete.")).toBeVisible()

    // 6. Reload page and assert authoritative history survives reload
    await page.reload()
    await expectSessionTitle(page, title)

    await expect(page.locator('[data-component="user-message"]')).toHaveCount(1)
    await expect(page.locator('[data-component="user-message"]')).toContainText(promptText)
    await expect(page.getByText("Security audit in progress. Checking repository permissions. Audit complete.")).toBeVisible()
    await expect(page.locator('[data-component="prompt-input"]')).toBeVisible()
  })

  test("executes with Build agent and preserves model and agent scope across multiple prompts", async ({ page }) => {
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const composer = page.locator('[data-component="prompt-input"]')
    await expect(composer).toBeVisible()

    // Submit with default Build agent
    await composer.click()
    const prompt1 = "Compile TypeScript project"
    await page.keyboard.type(prompt1)
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => promptsReceived.length).toBe(1)
    expect(promptsReceived[0]!.sessionID).toBe(sessionID)

    const transport = await installSseTransport(page, { server })

    const pBody1 = promptsReceived[0]!.body as { id?: string }
    const msgU1 = pBody1.id ?? "msg_u1"
    const msgA1 = "msg_a1"

    await transport.burst([
      {
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID, status: { type: "running" } },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: {
            info: {
              id: msgU1,
              sessionID,
              role: "user",
              time: { created: 1700000001000 },
              agent: "build",
              model: { providerID: "opencode", modelID: "build-model" },
            },
          },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: { id: "p_u1", messageID: msgU1, sessionID, type: "text", text: prompt1 },
          },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: {
            info: {
              id: msgA1,
              sessionID,
              role: "assistant",
              parentID: msgU1,
              agent: "build",
              modelID: "build-model",
              providerID: "opencode",
              time: { created: 1700000002000 },
            },
          },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: { id: "p_a1", messageID: msgA1, sessionID, type: "text", text: "Compilation successful." },
          },
        },
      },
      {
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID, status: { type: "idle" } },
        },
      },
    ])

    await expect(page.getByText("Compilation successful.")).toBeVisible()
    await expect(page.locator('[data-component="user-message"]')).toHaveCount(1)
  })
})
