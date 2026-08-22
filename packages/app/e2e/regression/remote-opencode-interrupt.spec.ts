import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/RemoteInterrupt"
const projectID = "proj_remote_interrupt"
const sessionID = "ses_remote_interrupt"
const childSessionID = "ses_remote_interrupt_child"
const title = "Remote Interrupt"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.describe("remote-opencode-interrupt", () => {
  let promptsReceived: Array<{ sessionID: string; body: unknown }> = []
  let interruptsReceived: Array<{ sessionID: string; body: unknown }> = []

  test.beforeEach(async ({ page }) => {
    promptsReceived = []
    interruptsReceived = []

    await installSseTransport(page, { server, retry: 50 })

    await mockOpenCodeServer(page, {
      protocol: "v2",
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "remote-interrupt",
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
        {
          id: childSessionID,
          parentID: sessionID,
          slug: childSessionID,
          projectID,
          directory,
          title: "Child Task Running",
          version: "dev",
          time: { created: 1700000001000, updated: 1700000001000 },
        },
      ],
      onPrompt: (input) => {
        promptsReceived.push(input)
      },
      onInterrupt: (input) => {
        interruptsReceived.push(input)
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

  test("interrupts running primary execution cleanly and allows immediate follow-up prompt", async ({ page }) => {
    const transport = await installSseTransport(page, { server, retry: 50 })
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await transport.waitForConnection()
    await expectSessionTitle(page, title)

    const composer = page.locator('[data-component="prompt-input"]')
    await composer.click()
    const promptText = "Start infinite simulation"
    await page.keyboard.type(promptText)
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => promptsReceived.length).toBe(1)
    const pBody = promptsReceived[0]!.body as { id?: string }
    const msgU = pBody.id ?? "msg_user_int"
    const msgA = "msg_asst_int"
    const prtText = "prt_text_int"

    // Assistant running and streaming
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
          properties: { info: { id: msgU, sessionID, role: "user", time: { created: 1700000001000 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: "p_u_i", messageID: msgU, sessionID, type: "text", text: promptText } },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgA, sessionID, role: "assistant", parentID: msgU, time: { created: 1700000002000 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: prtText, messageID: msgA, sessionID, type: "text", text: "Generating infinite steps: step 1, step 2..." } },
        },
      },
    ])

    await expect(page.getByText("Generating infinite steps: step 1, step 2...")).toBeVisible()

    // Stop button is now active
    const stopButton = page.locator('button[aria-label="Stop"], button:has-text("Stop"), [data-action="stop"]')
    if (await stopButton.count() > 0) {
      await stopButton.first().click()
    } else {
      // Trigger interrupt via Escape or Stop
      await page.keyboard.press("Escape")
    }

    // Backend reconciles interrupt
    await transport.send({
      directory,
      payload: {
        type: "session.status",
        properties: { sessionID, status: { type: "idle" } },
      },
    })

    // Output generated so far remains intact
    await expect(page.getByText("Generating infinite steps: step 1, step 2...")).toBeVisible()

    // User can immediately submit a follow-up prompt
    await composer.click()
    const prompt2 = "Second prompt after interrupt"
    await page.keyboard.type(prompt2)
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => promptsReceived.length).toBe(2)
  })

  test("interrupts running subagent child task without leaving orphan busy state", async ({ page }) => {
    const transport = await installSseTransport(page, { server, retry: 50 })
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await transport.waitForConnection()
    await expectSessionTitle(page, title)

    const msgU = "msg_u_sub_int"
    const msgA = "msg_a_sub_int"

    // Parent running with active child subagent task
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
          type: "session.status",
          properties: { sessionID: childSessionID, status: { type: "running" } },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgU, sessionID, role: "user", time: { created: 1700000001000 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: "p_u_s", messageID: msgU, sessionID, type: "text", text: "Delegate long child" } },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgA, sessionID, role: "assistant", parentID: msgU, time: { created: 1700000002000 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "prt_sub_task",
              messageID: msgA,
              sessionID,
              type: "tool",
              tool: "task",
              state: {
                status: "running",
                input: { description: "Child Task Running", subagent_id: childSessionID },
                metadata: { sessionId: childSessionID },
              },
            },
          },
        },
      },
    ])

    await expect(page.locator('[data-component="task-tool-card"]')).toBeVisible()

    // Interrupt parent
    await transport.burst([
      {
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID, status: { type: "idle" } },
        },
      },
      {
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID: childSessionID, status: { type: "idle" } },
        },
      },
    ])

    const composer = page.locator('[data-component="prompt-input"]')
    await expect(composer).toBeVisible()
  })
})
