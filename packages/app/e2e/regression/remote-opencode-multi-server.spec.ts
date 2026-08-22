import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockMultiServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"

const directory = "/workspace/project"
const projectID = "proj_collide"
const sessionID = "ses_collide"
const title = "Fix bug"

const serverAUrl = "http://127.0.0.1:4096"
const serverBUrl = "http://127.0.0.1:4097"
const serverAId = "srv_alpha_4096"
const serverBId = "srv_beta_4097"

test.describe("remote-opencode-multi-server", () => {
  let serverAPrompts: Array<{ sessionID: string; body: unknown }> = []
  let serverBPrompts: Array<{ sessionID: string; body: unknown }> = []
  let serverAHealthy = true
  let serverBHealthy = true

  let serverAMessages: Record<string, unknown[]> = {}
  let serverBMessages: Record<string, unknown[]> = {}

  test.beforeEach(async ({ page }) => {
    serverAPrompts = []
    serverBPrompts = []
    serverAHealthy = true
    serverBHealthy = true
    serverAMessages = { [sessionID]: [] }
    serverBMessages = { [sessionID]: [] }

    await installSseTransport(page, { server: serverAUrl, retry: 20 })

    await mockMultiServer(page, [
      // Server A
      {
        serverId: serverAId,
        serverUrl: serverAUrl,
        name: "Server Alpha",
        protocol: "v2",
        directory,
        project: {
          id: projectID,
          worktree: directory,
          vcs: "git",
          name: "app",
          time: { created: 1700000000000, updated: 1700000000000 },
          sandboxes: [],
        },
        provider: {
          all: [
            {
              id: "provider-a",
              name: "Provider A",
              models: { "model-a": { id: "model-a", name: "Model A", limit: { context: 200_000 } } },
            },
          ],
          connected: ["provider-a"],
          default: { providerID: "provider-a", modelID: "model-a" },
        },
        agents: [{ id: "build", name: "build", mode: "primary", hidden: false }],
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
          serverAPrompts.push(input)
        },
        pageMessages: (sid) => ({ items: serverAMessages[sid] ?? [] }),
        healthy: serverAHealthy,
      },
      // Server B (Deliberate Collisions on directory, projectID, sessionID, and title!)
      {
        serverId: serverBId,
        serverUrl: serverBUrl,
        name: "Server Beta",
        protocol: "v2",
        directory,
        project: {
          id: projectID,
          worktree: directory,
          vcs: "git",
          name: "app",
          time: { created: 1700000000000, updated: 1700000000000 },
          sandboxes: [],
        },
        provider: {
          all: [
            {
              id: "provider-b",
              name: "Provider B",
              models: { "model-b": { id: "model-b", name: "Model B", limit: { context: 200_000 } } },
            },
          ],
          connected: ["provider-b"],
          default: { providerID: "provider-b", modelID: "model-b" },
        },
        agents: [{ id: "plan", name: "plan", mode: "primary", hidden: false }],
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
          serverBPrompts.push(input)
        },
        pageMessages: (sid) => ({ items: serverBMessages[sid] ?? [] }),
        healthy: serverBHealthy,
      },
    ])

    await page.addInitScript(
      ({ directory, serverAUrl, serverBUrl, sessionID }) => {
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
          JSON.stringify([
            { type: "session", server: serverAUrl, sessionId: sessionID },
            { type: "session", server: serverBUrl, sessionId: sessionID },
          ]),
        )
      },
      { directory, serverAUrl, serverBUrl, sessionID },
    )
  })

  test("proves complete multi-server isolation: independent SSE, collision immunity, and failure resilience", async ({ page }) => {
    // 1. Load Server A session
    await page.goto(`/server/${base64Encode(serverAId)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const composerA = page.locator('[data-component="prompt-input"]')
    await expect(composerA).toBeVisible()

    // 2. Submit prompt on Server A
    await composerA.click()
    const promptTextA = "Run analysis on Server Alpha"
    await page.keyboard.type(promptTextA)
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => serverAPrompts.length).toBe(1)
    expect(serverBPrompts.length).toBe(0)

    const transport = await installSseTransport(page, { server: serverAUrl })
    const pBodyA = serverAPrompts[0]!.body as { id?: string }
    const msgU_A = pBodyA.id ?? "msg_user_a"
    const msgA_A = "msg_asst_a"
    const responseTextA = "Exclusive response from Server Alpha."

    await transport.burst([
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgU_A, sessionID, role: "user", time: { created: 1700000001000 }, agent: "build" } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: "p_u_a", messageID: msgU_A, sessionID, type: "text", text: promptTextA } },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgA_A, sessionID, role: "assistant", parentID: msgU_A, time: { created: 1700000002000 }, agent: "build" } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: "p_a_a", messageID: msgA_A, sessionID, type: "text", text: responseTextA } },
        },
      },
      {
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID, status: { type: "idle" } },
        },
      },
    ], [
      { serverId: serverAId },
      { serverId: serverAId },
      { serverId: serverAId },
      { serverId: serverAId },
      { serverId: serverAId },
    ])

    await expect(page.getByText(responseTextA)).toBeVisible()

    // Store in Server A messages
    serverAMessages[sessionID] = [
      {
        info: { id: msgU_A, sessionID, role: "user", time: { created: 1700000001000 }, agent: "build" },
        parts: [{ id: "p_u_a", messageID: msgU_A, sessionID, type: "text", text: promptTextA }],
      },
      {
        info: { id: msgA_A, sessionID, role: "assistant", parentID: msgU_A, time: { created: 1700000002000 }, agent: "build" },
        parts: [{ id: "p_a_a", messageID: msgA_A, sessionID, type: "text", text: responseTextA }],
      },
    ]

    // 3. Switch to Server B session (identical directory and sessionID!)
    await page.goto(`/server/${base64Encode(serverBId)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    // Assert Server A's response NEVER bled into Server B!
    await expect(page.getByText(responseTextA)).toHaveCount(0)

    const composerB = page.locator('[data-component="prompt-input"]')
    await expect(composerB).toBeVisible()

    // 4. Submit prompt on Server B
    await composerB.click()
    const promptTextB = "Run analysis on Server Beta"
    await page.keyboard.type(promptTextB)
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => serverBPrompts.length).toBe(1)
    expect(serverAPrompts.length).toBe(1)

    const pBodyB = serverBPrompts[0]!.body as { id?: string }
    const msgU_B = pBodyB.id ?? "msg_user_b"
    const msgA_B = "msg_asst_b"
    const responseTextB = "Exclusive response from Server Beta."

    await transport.burst([
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgU_B, sessionID, role: "user", time: { created: 1700000003000 }, agent: "plan" } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: "p_u_b", messageID: msgU_B, sessionID, type: "text", text: promptTextB } },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgA_B, sessionID, role: "assistant", parentID: msgU_B, time: { created: 1700000004000 }, agent: "plan" } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: "p_a_b", messageID: msgA_B, sessionID, type: "text", text: responseTextB } },
        },
      },
      {
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID, status: { type: "idle" } },
        },
      },
    ], [
      { serverId: serverBId },
      { serverId: serverBId },
      { serverId: serverBId },
      { serverId: serverBId },
      { serverId: serverBId },
    ])

    await expect(page.getByText(responseTextB)).toBeVisible()
    await expect(page.getByText(responseTextA)).toHaveCount(0)

    // 5. Fail Server A and verify Server B remains interactive and unaffected
    serverAHealthy = false
    await transport.disconnect("Server A went down", { serverId: serverAId }).catch(() => {})

    // Server B is still open and ready
    await expect(page.getByText(responseTextB)).toBeVisible()
    await expect(composerB).toBeVisible()

    // Send a follow-up on Server B while Server A is dead
    await composerB.click()
    const promptTextB2 = "Follow-up query on Server Beta"
    await page.keyboard.type(promptTextB2)
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => serverBPrompts.length).toBe(2)
  })
})
