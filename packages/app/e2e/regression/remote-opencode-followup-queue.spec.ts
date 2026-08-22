import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/RemoteFollowupQueue"
const projectID = "proj_remote_followup"
const sessionID = "ses_remote_followup"
const title = "Follow-up Queue Execution"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.describe("remote-opencode-followup-queue", () => {
  let promptsReceived: Array<{ sessionID: string; body: unknown }> = []

  test.beforeEach(async ({ page }) => {
    promptsReceived = []

    await installSseTransport(page, { server, retry: 50 })

    await mockOpenCodeServer(page, {
      protocol: "v2",
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "remote-followup",
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
      onPrompt: (input) => {
        promptsReceived.push(input)
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

  test("submits follow-up prompts and executes sequentially without duplication", async ({ page }) => {
    const transport = await installSseTransport(page, { server, retry: 50 })
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await transport.waitForConnection()
    await expectSessionTitle(page, title)

    const composer = page.locator('[data-component="prompt-input"]')
    await composer.click()
    const prompt1 = "First long running task"
    await page.keyboard.type(prompt1)
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => promptsReceived.length).toBe(1)
    const p1Body = promptsReceived[0]!.body as { id?: string }
    const msgU1 = p1Body.id ?? "msg_u1"
    const msgA1 = "msg_a1"

    // Prompt 1 is running
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
          properties: { info: { id: msgU1, sessionID, role: "user", time: { created: 1700000001000 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: "p_u_1", messageID: msgU1, sessionID, type: "text", text: prompt1 } },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgA1, sessionID, role: "assistant", parentID: msgU1, time: { created: 1700000002000 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: "p_a_1", messageID: msgA1, sessionID, type: "text", text: "Processing first task..." } },
        },
      },
    ])

    // Prompt 1 finishes
    await transport.burst([
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: "p_a_1", messageID: msgA1, sessionID, type: "text", text: "First task finished." } },
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

    await expect(page.getByText("First task finished.")).toBeVisible()

    // Submit Prompt 2 (follow-up)
    await composer.click()
    const prompt2 = "Second task following up"
    await page.keyboard.type(prompt2)
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => promptsReceived.length).toBe(2)
    const p2Body = promptsReceived[1]!.body as { id?: string }
    const msgU2 = p2Body.id ?? "msg_u2"
    const msgA2 = "msg_a2"

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
          properties: { info: { id: msgU2, sessionID, role: "user", time: { created: 1700000003000 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: "p_u_2", messageID: msgU2, sessionID, type: "text", text: prompt2 } },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgA2, sessionID, role: "assistant", parentID: msgU2, time: { created: 1700000004000 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: "p_a_2", messageID: msgA2, sessionID, type: "text", text: "Second task completed." } },
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

    await expect(page.getByText("Second task completed.")).toBeVisible()
    await expect(page.locator('[data-component="user-message"]')).toHaveCount(2)
  })
})
