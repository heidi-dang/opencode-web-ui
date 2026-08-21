import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/RemoteSubagent"
const projectID = "proj_remote_subagent"
const parentSessionID = "ses_parent_subagent"
const childSessionID = "ses_child_subagent"
const title = "Remote Subagent Execution"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.describe("remote-opencode-subagent-execution", () => {
  test.beforeEach(async ({ page }) => {
    await mockOpenCodeServer(page, {
      protocol: "v2",
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "remote-subagent",
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
      sessions: [
        {
          id: parentSessionID,
          slug: parentSessionID,
          projectID,
          directory,
          title,
          version: "dev",
          time: { created: 1700000000000, updated: 1700000000000 },
        },
        {
          id: childSessionID,
          parentID: parentSessionID,
          slug: childSessionID,
          projectID,
          directory,
          title: "Subagent Child Task",
          version: "dev",
          time: { created: 1700000001000, updated: 1700000001000 },
        },
      ],
      pageMessages: (sid) => ({
        items: sid === parentSessionID ? [
          {
            info: { id: "msg_p1", sessionID: parentSessionID, role: "user", time: { created: 1700000000000 } },
            parts: [{ id: "prt_p1", messageID: "msg_p1", sessionID: parentSessionID, type: "text", text: "Delegate task to child" }],
          },
          {
            info: { id: "msg_p2", sessionID: parentSessionID, role: "assistant", time: { created: 1700000000500 }, parentID: "msg_p1" },
            parts: [
              {
                id: "prt_p2_task",
                messageID: "msg_p2",
                sessionID: parentSessionID,
                type: "tool",
                tool: "task",
                state: {
                  status: "completed",
                  input: { description: "Subagent Child Task", subagent_id: childSessionID },
                  output: "Child task completed successfully",
                  metadata: { sessionId: childSessionID },
                },
              },
            ],
          },
        ] : [
          {
            info: { id: "msg_c1", sessionID: childSessionID, role: "user", time: { created: 1700000000600 } },
            parts: [{ id: "prt_c1", messageID: "msg_c1", sessionID: childSessionID, type: "text", text: "Perform child task" }],
          },
        ],
      }),
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
      { directory, server, sessionID: parentSessionID },
    )
  })

  test("renders parent session with completed task tool part pointing to child session", async ({ page }) => {
    await page.goto(`/server/${base64Encode(server)}/session/${parentSessionID}`)
    await expectSessionTitle(page, title)

    const userMessage = page.locator('[data-component="user-message"]')
    await expect(userMessage).toBeVisible()

    const taskPart = page.locator('[data-component="task-tool-card"]')
    await expect(taskPart).toBeVisible()
  })
})
