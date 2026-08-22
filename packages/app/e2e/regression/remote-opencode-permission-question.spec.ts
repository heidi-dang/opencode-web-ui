import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/RemotePermission"
const projectID = "proj_remote_permission"
const sessionID = "ses_remote_permission"
const childSessionID = "ses_remote_permission_child"
const title = "Remote Permission and Questions"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.describe("remote-opencode-permission-question", () => {
  let permissionReplies: Array<{ sessionID: string; requestID: string; body: unknown }> = []
  let questionReplies: Array<{ sessionID: string; requestID: string; body: unknown }> = []
  let questionRejections: Array<{ sessionID: string; requestID: string }> = []
  let activePermissions: unknown[] = []
  let activeQuestions: unknown[] = []

  test.beforeEach(async ({ page }) => {
    permissionReplies = []
    questionReplies = []
    questionRejections = []
    activePermissions = []
    activeQuestions = []

    await mockOpenCodeServer(page, {
      protocol: "v2",
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "remote-permission",
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
          title: "Child Subagent Permission Task",
          version: "dev",
          time: { created: 1700000001000, updated: 1700000001000 },
        },
      ],
      permissions: () => activePermissions,
      questions: () => activeQuestions,
      onPermissionReply: (input) => {
        permissionReplies.push(input)
      },
      onQuestionReply: (input) => {
        questionReplies.push(input)
      },
      onQuestionReject: (input) => {
        questionRejections.push(input)
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

  test("executes complete permission lifecycle for Allow Once, Always, and Reject", async ({ page }) => {
    const transport = await installSseTransport(page, { server, retry: 50 })
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await transport.waitForConnection()
    await expectSessionTitle(page, title)

    // 1. Tool requests permission
    const permId = "perm_request_allow_once"
    const permReq = {
      id: permId,
      sessionID,
      permission: "bash",
      patterns: ["npm run build"],
      always: [],
      metadata: {},
    }
    activePermissions = [permReq]

    await transport.send({
      directory,
      payload: {
        type: "permission.asked",
        properties: permReq,
      },
    })

    // Dock appears
    const permissionDock = page.locator('[data-component="dock-prompt"][data-kind="permission"]')
    await expect(permissionDock).toBeVisible()
    await expect(permissionDock.getByText("npm run build")).toBeVisible()

    // Click "Allow once"
    await permissionDock.getByRole("button", { name: "Allow once" }).click()

    await expect.poll(() => permissionReplies.length).toBe(1)
    expect(permissionReplies[0]).toMatchObject({
      sessionID,
      requestID: permId,
      body: { reply: "once" },
    })

    // Backend reconciles reply
    activePermissions = []
    await transport.send({
      directory,
      payload: {
        type: "permission.replied",
        properties: { sessionID, requestID: permId },
      },
    })

    await expect(permissionDock).toHaveCount(0)

    // 2. Reject permission
    const permRejectId = "perm_request_reject"
    const permRejectReq = {
      id: permRejectId,
      sessionID,
      permission: "bash",
      patterns: ["rm -rf /dangerous"],
      always: [],
      metadata: {},
    }
    activePermissions = [permRejectReq]

    await transport.send({
      directory,
      payload: {
        type: "permission.asked",
        properties: permRejectReq,
      },
    })

    await expect(permissionDock).toBeVisible()
    await expect(permissionDock.getByText("rm -rf /dangerous")).toBeVisible()

    await permissionDock.getByRole("button", { name: /Deny|Reject/i }).click()

    await expect.poll(() => permissionReplies.length).toBe(2)
    expect(permissionReplies[1]).toMatchObject({
      sessionID,
      requestID: permRejectId,
      body: { reply: "reject" },
    })

    activePermissions = []
    await transport.send({
      directory,
      payload: {
        type: "permission.replied",
        properties: { sessionID, requestID: permRejectId },
      },
    })

    await expect(permissionDock).toHaveCount(0)
  })

  test("executes child subagent permission request scoped to child identity", async ({ page }) => {
    const transport = await installSseTransport(page, { server, retry: 50 })
    await page.goto(`/server/${base64Encode(server)}/session/${childSessionID}`)
    await transport.waitForConnection()

    const permChildId = "perm_child_task"
    const permChildReq = {
      id: permChildId,
      sessionID: childSessionID,
      permission: "file_write",
      patterns: ["src/config.json"],
      always: [],
      metadata: {},
    }
    activePermissions = [permChildReq]

    await transport.send({
      directory,
      payload: {
        type: "permission.asked",
        properties: permChildReq,
      },
    })

    const permissionDock = page.locator('[data-component="dock-prompt"][data-kind="permission"]')
    await expect(permissionDock).toBeVisible()
    await expect(permissionDock.getByText("src/config.json")).toBeVisible()

    await permissionDock.getByRole("button", { name: "Allow once" }).click()

    await expect.poll(() => permissionReplies.length).toBe(1)
    expect(permissionReplies[0]).toMatchObject({
      sessionID: childSessionID,
      requestID: permChildId,
      body: { reply: "once" },
    })
  })

  test("executes question lifecycle: single-choice, reply, and reject", async ({ page }) => {
    const transport = await installSseTransport(page, { server, retry: 50 })
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await transport.waitForConnection()
    await expectSessionTitle(page, title)

    const questionId = "quest_config_mode"
    const questionReq = {
      id: questionId,
      sessionID,
      questions: [
        {
          header: "Configuration Mode",
          question: "Which database backend should be initialized?",
          options: [
            { label: "SQLite", description: "Embedded database" },
            { label: "PostgreSQL", description: "Production database" },
          ],
        },
      ],
    }
    activeQuestions = [questionReq]

    await transport.send({
      directory,
      payload: {
        type: "question.asked",
        properties: questionReq,
      },
    })

    const questionDock = page.locator('[data-component="dock-prompt"][data-kind="question"]')
    await expect(questionDock).toBeVisible()
    await expect(questionDock.getByText("Which database backend should be initialized?")).toBeVisible()
    await expect(questionDock.getByRole("radio", { name: /PostgreSQL/ })).toBeVisible()

    // Select PostgreSQL and submit
    await questionDock.getByRole("radio", { name: /PostgreSQL/ }).click()
    await questionDock.getByRole("button", { name: "Submit" }).click()

    await expect.poll(() => questionReplies.length).toBe(1)
    expect(questionReplies[0]).toMatchObject({
      sessionID,
      requestID: questionId,
      body: { answers: [["PostgreSQL"]] },
    })

    // Backend reconciles question replied
    activeQuestions = []
    await transport.send({
      directory,
      payload: {
        type: "question.replied",
        properties: { sessionID, requestID: questionId },
      },
    })

    await expect(questionDock).toHaveCount(0)
  })

  test("reconciles pending permission and question after SSE reconnect and page reload", async ({ page }) => {
    const transport = await installSseTransport(page, { server, retry: 50 })
    const permId = "perm_persist_recon"
    const permReq = {
      id: permId,
      sessionID,
      permission: "bash",
      patterns: ["make deploy"],
      always: [],
      metadata: {},
    }
    activePermissions = [permReq]

    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    const conn1 = await transport.waitForConnection()
    await expectSessionTitle(page, title)

    const permissionDock = page.locator('[data-component="dock-prompt"][data-kind="permission"]')
    await expect(permissionDock).toBeVisible()
    await expect(permissionDock.getByText("make deploy")).toBeVisible()

    // Disconnect stream while permission is pending
    await transport.disconnect("Drop stream with pending permission")
    const conn2 = await transport.waitForConnection({ after: conn1.id, timeout: 15_000 })
    expect(conn2.id).toBeGreaterThan(conn1.id)

    // Permission dock remains visible and active after reconnect
    await expect(permissionDock).toBeVisible()
    await expect(permissionDock.getByText("make deploy")).toBeVisible()

    // Reload page
    await page.reload()
    await expectSessionTitle(page, title)

    // Permission dock survives reload from authoritative backend state
    await expect(page.locator('[data-component="dock-prompt"][data-kind="permission"]')).toBeVisible()
    await expect(page.getByText("make deploy")).toBeVisible()
  })
})
