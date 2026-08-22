import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/RemoteSseRecovery"
const projectID = "proj_remote_sse"
const sessionID = "ses_remote_sse"
const title = "Remote SSE Recovery"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.describe("remote-opencode-sse-recovery", () => {
  let promptsReceived: Array<{ sessionID: string; body: unknown }> = []
  let storeMessages: Array<unknown> = []

  test.beforeEach(async ({ page }) => {
    promptsReceived = []
    storeMessages = []

    await installSseTransport(page, { server, retry: 50 })

    await mockOpenCodeServer(page, {
      protocol: "v2",
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "remote-sse",
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
      pageMessages: () => ({ items: storeMessages }),
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

  test("recovers from disconnection during reasoning without duplicating state or sending Last-Event-ID", async ({ page }) => {
    const transport = await installSseTransport(page, { server, retry: 50 })
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    const conn1 = await transport.waitForConnection()
    await expectSessionTitle(page, title)

    const composer = page.locator('[data-component="prompt-input"]')
    await composer.click()
    const promptText = "Analyze algorithm complexity"
    await page.keyboard.type(promptText)
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => promptsReceived.length).toBe(1)
    const pBody = promptsReceived[0]!.body as { id?: string }
    const msgU = pBody.id ?? "msg_user_reasoning"
    const msgA = "msg_asst_reasoning"
    const prtReason = "prt_reason_1"
    const prtText = "prt_text_1"

    // Initial streaming events
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
          properties: { part: { id: "p_u_r", messageID: msgU, sessionID, type: "text", text: promptText } },
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
          properties: { part: { id: prtReason, messageID: msgA, sessionID, type: "reasoning", text: "Analyzing algorithm structure..." } },
        },
      },
    ])

    // Disconnect stream during reasoning
    await transport.disconnect("Deliberate network disruption during reasoning")

    // Wait for automatic reconnect
    const conn2 = await transport.waitForConnection({ after: conn1.id, timeout: 15_000 })
    expect(conn2.id).toBeGreaterThan(conn1.id)
    expect(conn2.headers["last-event-id"]).toBeUndefined()

    // Resume streaming after reconnection
    await transport.burst([
      {
        directory,
        payload: {
          type: "message.part.delta",
          properties: { sessionID, messageID: msgA, partID: prtReason, field: "text", delta: " and calculating Big-O." },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: prtText, messageID: msgA, sessionID, type: "text", text: "Complexity is O(n log n)." } },
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

    await expect(page.getByText("Complexity is O(n log n).")).toBeVisible()
    await expect(page.locator('[data-component="user-message"]')).toHaveCount(1)
  })

  test("recovers from disconnection during text streaming and emits exact text once", async ({ page }) => {
    const transport = await installSseTransport(page, { server, retry: 50 })
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    const conn1 = await transport.waitForConnection()
    await expectSessionTitle(page, title)

    const composer = page.locator('[data-component="prompt-input"]')
    await composer.click()
    const promptText = "Say hello world"
    await page.keyboard.type(promptText)
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => promptsReceived.length).toBe(1)
    const pBody = promptsReceived[0]!.body as { id?: string }
    const msgU = pBody.id ?? "msg_user_text"
    const msgA = "msg_asst_text"
    const prtText = "prt_text_hw"

    // Emit initial text part: "hello "
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
          properties: { part: { id: "p_u_hw", messageID: msgU, sessionID, type: "text", text: promptText } },
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
          properties: { part: { id: prtText, messageID: msgA, sessionID, type: "text", text: "hello " } },
        },
      },
    ])

    await expect(page.getByText("hello ")).toBeVisible()

    // Disconnect stream
    await transport.disconnect("Deliberate network disruption during text")

    // Wait for reconnect
    const conn2 = await transport.waitForConnection({ after: conn1.id, timeout: 15_000 })
    expect(conn2.id).toBeGreaterThan(conn1.id)

    // Complete text after reconnect: "world"
    await transport.burst([
      {
        directory,
        payload: {
          type: "message.part.delta",
          properties: { sessionID, messageID: msgA, partID: prtText, field: "text", delta: "world" },
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

    await expect(page.getByText("hello world", { exact: true })).toBeVisible()
    // Ensure "hello " is NOT duplicated
    await expect(page.getByText("hello hello")).toHaveCount(0)
    await expect(page.locator('[data-component="user-message"]')).toHaveCount(1)
  })

  test("recovers from disconnection during tool execution with single tool card", async ({ page }) => {
    const transport = await installSseTransport(page, { server, retry: 50 })
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    const conn1 = await transport.waitForConnection()
    await expectSessionTitle(page, title)

    const composer = page.locator('[data-component="prompt-input"]')
    await composer.click()
    const promptText = "Execute scanner tool"
    await page.keyboard.type(promptText)
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => promptsReceived.length).toBe(1)
    const pBody = promptsReceived[0]!.body as { id?: string }
    const msgU = pBody.id ?? "msg_user_tool"
    const msgA = "msg_asst_tool"
    const prtTool = "prt_tool_scanner"

    // Start tool
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
          properties: { part: { id: "p_u_t", messageID: msgU, sessionID, type: "text", text: promptText } },
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
              id: prtTool,
              messageID: msgA,
              sessionID,
              type: "tool",
              tool: "scanner",
              state: { status: "running", input: { target: "system" } },
            },
          },
        },
      },
    ])

    // Disconnect stream
    await transport.disconnect("Deliberate network disruption during tool")

    // Wait for reconnect
    const conn2 = await transport.waitForConnection({ after: conn1.id, timeout: 15_000 })
    expect(conn2.id).toBeGreaterThan(conn1.id)

    // Tool completes after reconnect
    await transport.burst([
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: prtTool,
              messageID: msgA,
              sessionID,
              type: "tool",
              tool: "scanner",
              state: {
                status: "completed",
                input: { target: "system" },
                output: "Scan passed cleanly.",
                metadata: {},
              },
            },
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

    await expect(page.locator('[data-component="tool-trigger"]')).toHaveCount(1)
    await expect(page.locator('[data-component="prompt-input"]')).toBeVisible()
  })

  test("disconnect immediately after completion does not replay or duplicate messages", async ({ page }) => {
    const transport = await installSseTransport(page, { server, retry: 50 })
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    const conn1 = await transport.waitForConnection()
    await expectSessionTitle(page, title)

    const composer = page.locator('[data-component="prompt-input"]')
    await composer.click()
    const promptText = "Quick message"
    await page.keyboard.type(promptText)
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => promptsReceived.length).toBe(1)
    const pBody = promptsReceived[0]!.body as { id?: string }
    const msgU = pBody.id ?? "msg_user_quick"
    const msgA = "msg_asst_quick"

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
          properties: { part: { id: "p_u_q", messageID: msgU, sessionID, type: "text", text: promptText } },
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
          properties: { part: { id: "p_a_q", messageID: msgA, sessionID, type: "text", text: "Quick reply." } },
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

    await expect(page.getByText("Quick reply.")).toBeVisible()

    // Disconnect right after completion
    await transport.disconnect("Deliberate network drop after completion")
    const conn2 = await transport.waitForConnection({ after: conn1.id, timeout: 15_000 })
    expect(conn2.id).toBeGreaterThan(conn1.id)

    // Reconnection should retain clean state with no duplicates
    await expect(page.getByText("Quick reply.")).toBeVisible()
    await expect(page.locator('[data-component="user-message"]')).toHaveCount(1)
  })
})
