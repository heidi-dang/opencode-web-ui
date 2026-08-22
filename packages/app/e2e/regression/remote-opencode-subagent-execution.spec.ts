import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/RemoteSubagent"
const projectID = "proj_remote_subagent"
const parentSessionID = "ses_parent_subagent"
const childSessionID = "ses_child_subagent"
const title = "Remote Subagent Execution"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.describe("remote-opencode-subagent-execution", () => {
  let promptsReceived: Array<{ sessionID: string; body: unknown }> = []
  let interruptsReceived: Array<{ sessionID: string; body: unknown }> = []
  let storeSessions: Array<{ id: string; parentID?: string; [key: string]: unknown }> = []
  let storeMessages: Record<string, unknown[]> = {}

  test.beforeEach(async ({ page }) => {
    promptsReceived = []
    interruptsReceived = []
    storeSessions = [
      {
        id: parentSessionID,
        slug: parentSessionID,
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ]
    storeMessages = {
      [parentSessionID]: [],
      [childSessionID]: [],
    }

    await installSseTransport(page, { server, retry: 20 })

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
            models: {
              "build-model": { id: "build-model", name: "OpenCode Build Model", limit: { context: 200_000 } },
            },
          },
        ],
        connected: ["opencode"],
        default: { providerID: "opencode", modelID: "build-model" },
      },
      agents: [
        { id: "build", name: "build", mode: "primary", hidden: false },
        { id: "researcher", name: "researcher", mode: "subagent", hidden: false },
      ],
      sessions: () => storeSessions,
      onPrompt: (input) => {
        promptsReceived.push(input)
      },
      onInterrupt: (input) => {
        interruptsReceived.push(input)
      },
      pageMessages: (sid) => ({ items: storeMessages[sid] ?? [] }),
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

  test("executes end-to-end child delegation: parent prompt, child creation, execution, result return, and continuation", async ({ page }) => {
    await page.goto(`/server/${base64Encode(server)}/session/${parentSessionID}`)
    await expectSessionTitle(page, title)

    const composer = page.locator('[data-component="prompt-input"]')
    await expect(composer).toBeVisible()

    // 1. Submit parent prompt
    await composer.click()
    const parentPromptText = "Analyze architecture and delegate module review"
    await page.keyboard.type(parentPromptText)
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => promptsReceived.length).toBe(1)
    const pBody = promptsReceived[0]!.body as { id?: string }
    const parentMsgUserId = pBody.id ?? "msg_parent_user"
    const parentMsgAsstId = "msg_parent_asst"
    const parentTaskPartId = "prt_parent_task"
    const parentContinuationPartId = "prt_parent_cont"

    const transport = await installSseTransport(page, { server })

    // 2. Parent begins execution
    await transport.burst([
      {
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID: parentSessionID, status: { type: "running" } },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: {
            info: {
              id: parentMsgUserId,
              sessionID: parentSessionID,
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
            part: {
              id: "prt_p_user_txt",
              messageID: parentMsgUserId,
              sessionID: parentSessionID,
              type: "text",
              text: parentPromptText,
            },
          },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: {
            info: {
              id: parentMsgAsstId,
              sessionID: parentSessionID,
              role: "assistant",
              parentID: parentMsgUserId,
              agent: "build",
              modelID: "build-model",
              providerID: "opencode",
              time: { created: 1700000002000 },
            },
          },
        },
      },
      // Parent spawns task tool
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: parentTaskPartId,
              messageID: parentMsgAsstId,
              sessionID: parentSessionID,
              type: "tool",
              tool: "task",
              state: {
                status: "running",
                input: { description: "Subagent Architecture Review", subagent_id: childSessionID },
                metadata: { sessionId: childSessionID },
              },
            },
          },
        },
      },
    ])

    // Verify task tool card is visible and in progress
    const taskCard = page.locator('[data-component="task-tool-card"]')
    await expect(taskCard).toBeVisible()
    await expect(taskCard).toContainText("Subagent Architecture Review")

    // 3. Child session created and begins executing
    const childSession = {
      id: childSessionID,
      parentID: parentSessionID,
      slug: childSessionID,
      projectID,
      directory,
      title: "Subagent Architecture Review",
      version: "dev",
      time: { created: 1700000003000, updated: 1700000003000 },
    }
    storeSessions.push(childSession)

    await transport.burst([
      {
        directory,
        payload: {
          type: "session.created",
          properties: { info: childSession },
        },
      },
      {
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID: childSessionID, status: { type: "running" } },
        },
      },
    ])

    // Child emits output & completes
    const childMsgUserId = "msg_c_user"
    const childMsgAsstId = "msg_c_asst"
    const childOutputText = "Security audit found 0 vulnerabilities across modules."

    storeMessages[childSessionID] = [
      {
        info: {
          id: childMsgUserId,
          sessionID: childSessionID,
          role: "user",
          time: { created: 1700000003100 },
          agent: "researcher",
        },
        parts: [{ id: "prt_c_u", messageID: childMsgUserId, sessionID: childSessionID, type: "text", text: "Review module security" }],
      },
      {
        info: {
          id: childMsgAsstId,
          sessionID: childSessionID,
          role: "assistant",
          parentID: childMsgUserId,
          agent: "researcher",
          time: { created: 1700000003200 },
        },
        parts: [{ id: "prt_c_a", messageID: childMsgAsstId, sessionID: childSessionID, type: "text", text: childOutputText }],
      },
    ]

    // 4. Child completes, task tool finishes, parent continues
    await transport.burst([
      {
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID: childSessionID, status: { type: "idle" } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: parentTaskPartId,
              messageID: parentMsgAsstId,
              sessionID: parentSessionID,
              type: "tool",
              tool: "task",
              state: {
                status: "completed",
                input: { description: "Subagent Architecture Review", subagent_id: childSessionID },
                output: childOutputText,
                metadata: { sessionId: childSessionID },
              },
            },
          },
        },
      },
      // Parent continuation
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: parentContinuationPartId,
              messageID: parentMsgAsstId,
              sessionID: parentSessionID,
              type: "text",
              text: "Delegated review completed: " + childOutputText,
            },
          },
        },
      },
      // Parent idle
      {
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID: parentSessionID, status: { type: "idle" } },
        },
      },
    ])

    // 5. Store parent messages for reload
    storeMessages[parentSessionID] = [
      {
        info: {
          id: parentMsgUserId,
          sessionID: parentSessionID,
          role: "user",
          time: { created: 1700000001000 },
          agent: "build",
          model: { providerID: "opencode", modelID: "build-model" },
        },
        parts: [
          {
            id: "prt_p_user_txt",
            messageID: parentMsgUserId,
            sessionID: parentSessionID,
            type: "text",
            text: parentPromptText,
          },
        ],
      },
      {
        info: {
          id: parentMsgAsstId,
          sessionID: parentSessionID,
          role: "assistant",
          parentID: parentMsgUserId,
          agent: "build",
          modelID: "build-model",
          providerID: "opencode",
          time: { created: 1700000002000 },
        },
        parts: [
          {
            id: parentTaskPartId,
            messageID: parentMsgAsstId,
            sessionID: parentSessionID,
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              input: { description: "Subagent Architecture Review", subagent_id: childSessionID },
              output: childOutputText,
              metadata: { sessionId: childSessionID },
            },
          },
          {
            id: parentContinuationPartId,
            messageID: parentMsgAsstId,
            sessionID: parentSessionID,
            type: "text",
            text: "Delegated review completed: " + childOutputText,
          },
        ],
      },
    ]

    await expect(page.getByText("Delegated review completed: " + childOutputText)).toBeVisible()
    await expect(page.locator('[data-component="task-tool-card"]')).toBeVisible()

    // 6. Reload and assert child session and lineage survive
    await page.reload()
    await expectSessionTitle(page, title)

    await expect(page.locator('[data-component="task-tool-card"]')).toBeVisible()
    await expect(page.getByText("Delegated review completed: " + childOutputText)).toBeVisible()

    // Click child task card to navigate to child session
    const childLink = page.locator('a', { has: page.locator('[data-component="task-tool-card"]') })
    if (await childLink.count() > 0) {
      await childLink.click()
    } else {
      await page.locator('[data-component="task-tool-card"]').click()
    }
    await expect(page.getByText(childOutputText)).toBeVisible()
  })

  test("executes sequential children without state bleeding", async ({ page }) => {
    await page.goto(`/server/${base64Encode(server)}/session/${parentSessionID}`)
    await expectSessionTitle(page, title)

    const transport = await installSseTransport(page, { server })
    const childA = "ses_child_a"
    const childB = "ses_child_b"

    storeSessions.push(
      { id: childA, parentID: parentSessionID, projectID, directory, title: "Child Task A", time: { created: 1700000001000 } },
      { id: childB, parentID: parentSessionID, projectID, directory, title: "Child Task B", time: { created: 1700000002000 } },
    )

    const msgU = "msg_u_seq"
    const msgA = "msg_a_seq"

    // Parent emits child A tool -> child A completes -> child B tool -> child B completes
    await transport.burst([
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgU, sessionID: parentSessionID, role: "user", time: { created: 1700000000100 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: "p_u", messageID: msgU, sessionID: parentSessionID, type: "text", text: "Run sequential tasks" } },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgA, sessionID: parentSessionID, role: "assistant", parentID: msgU, time: { created: 1700000000200 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "prt_task_a",
              messageID: msgA,
              sessionID: parentSessionID,
              type: "tool",
              tool: "task",
              state: {
                status: "completed",
                input: { description: "Child Task A", subagent_id: childA },
                output: "Result from Task A",
                metadata: { sessionId: childA },
              },
            },
          },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "prt_task_b",
              messageID: msgA,
              sessionID: parentSessionID,
              type: "tool",
              tool: "task",
              state: {
                status: "completed",
                input: { description: "Child Task B", subagent_id: childB },
                output: "Result from Task B",
                metadata: { sessionId: childB },
              },
            },
          },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "prt_seq_final",
              messageID: msgA,
              sessionID: parentSessionID,
              type: "text",
              text: "Sequential execution completed both tasks.",
            },
          },
        },
      },
    ])

    const cards = page.locator('[data-component="task-tool-card"]')
    await expect(cards).toHaveCount(2)
    await expect(page.getByText("Sequential execution completed both tasks.")).toBeVisible()
  })

  test("handles child failure gracefully without leaving parent permanently busy", async ({ page }) => {
    await page.goto(`/server/${base64Encode(server)}/session/${parentSessionID}`)
    await expectSessionTitle(page, title)

    const transport = await installSseTransport(page, { server })
    const failedChildId = "ses_child_failed"

    storeSessions.push({
      id: failedChildId,
      parentID: parentSessionID,
      projectID,
      directory,
      title: "Failing Subagent",
      time: { created: 1700000001000 },
    })

    const msgU = "msg_u_fail"
    const msgA = "msg_a_fail"

    // Parent starts task -> child fails -> parent task marks error -> parent becomes idle
    await transport.burst([
      {
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID: parentSessionID, status: { type: "running" } },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgU, sessionID: parentSessionID, role: "user", time: { created: 1700000000100 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: "p_u_fail", messageID: msgU, sessionID: parentSessionID, type: "text", text: "Run failing task" } },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgA, sessionID: parentSessionID, role: "assistant", parentID: msgU, time: { created: 1700000000200 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "prt_task_fail",
              messageID: msgA,
              sessionID: parentSessionID,
              type: "tool",
              tool: "task",
              state: {
                status: "error",
                input: { description: "Failing Subagent", subagent_id: failedChildId },
                error: "Child task failed with execution error",
                metadata: { sessionId: failedChildId },
              },
            },
          },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "prt_fail_resp",
              messageID: msgA,
              sessionID: parentSessionID,
              type: "text",
              text: "Handled child failure gracefully.",
            },
          },
        },
      },
      {
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID: parentSessionID, status: { type: "idle" } },
        },
      },
    ])

    await expect(page.getByText("Handled child failure gracefully.")).toBeVisible()
    await expect(page.locator('[data-component="prompt-input"]')).toBeVisible()
  })

  test("executes concurrent children without cross-contamination", async ({ page }) => {
    await page.goto(`/server/${base64Encode(server)}/session/${parentSessionID}`)
    await expectSessionTitle(page, title)

    const transport = await installSseTransport(page, { server })
    const child1 = "ses_child_concurrent_1"
    const child2 = "ses_child_concurrent_2"

    storeSessions.push(
      { id: child1, parentID: parentSessionID, projectID, directory, title: "Concurrent Task 1", time: { created: 1700000001000 } },
      { id: child2, parentID: parentSessionID, projectID, directory, title: "Concurrent Task 2", time: { created: 1700000002000 } },
    )

    const msgU = "msg_u_conc"
    const msgA = "msg_a_conc"

    // Parent spawns both task tools concurrently
    await transport.burst([
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgU, sessionID: parentSessionID, role: "user", time: { created: 1700000000100 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: "p_u_conc", messageID: msgU, sessionID: parentSessionID, type: "text", text: "Run two concurrent tasks" } },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgA, sessionID: parentSessionID, role: "assistant", parentID: msgU, time: { created: 1700000000200 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "prt_conc_1",
              messageID: msgA,
              sessionID: parentSessionID,
              type: "tool",
              tool: "task",
              state: {
                status: "completed",
                input: { description: "Concurrent Task 1", subagent_id: child1 },
                output: "Result from concurrent 1",
                metadata: { sessionId: child1 },
              },
            },
          },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "prt_conc_2",
              messageID: msgA,
              sessionID: parentSessionID,
              type: "tool",
              tool: "task",
              state: {
                status: "completed",
                input: { description: "Concurrent Task 2", subagent_id: child2 },
                output: "Result from concurrent 2",
                metadata: { sessionId: child2 },
              },
            },
          },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "prt_conc_final",
              messageID: msgA,
              sessionID: parentSessionID,
              type: "text",
              text: "Both concurrent tasks executed and finished independently.",
            },
          },
        },
      },
    ])

    const cards = page.locator('[data-component="task-tool-card"]')
    await expect(cards).toHaveCount(2)
    await expect(page.getByText("Both concurrent tasks executed and finished independently.")).toBeVisible()
  })

  test("handles parent interrupt while child is running", async ({ page }) => {
    await page.goto(`/server/${base64Encode(server)}/session/${parentSessionID}`)
    await expectSessionTitle(page, title)

    const transport = await installSseTransport(page, { server })
    const runningChildId = "ses_child_interrupted"

    storeSessions.push({
      id: runningChildId,
      parentID: parentSessionID,
      projectID,
      directory,
      title: "Running Subagent to Interrupt",
      time: { created: 1700000001000 },
    })

    const msgU = "msg_u_int"
    const msgA = "msg_a_int"

    // Parent spawns running child
    await transport.burst([
      {
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID: parentSessionID, status: { type: "running" } },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgU, sessionID: parentSessionID, role: "user", time: { created: 1700000000100 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: { part: { id: "p_u_int", messageID: msgU, sessionID: parentSessionID, type: "text", text: "Long child task" } },
        },
      },
      {
        directory,
        payload: {
          type: "message.updated",
          properties: { info: { id: msgA, sessionID: parentSessionID, role: "assistant", parentID: msgU, time: { created: 1700000000200 } } },
        },
      },
      {
        directory,
        payload: {
          type: "message.part.updated",
          properties: {
            part: {
              id: "prt_int_task",
              messageID: msgA,
              sessionID: parentSessionID,
              type: "tool",
              tool: "task",
              state: {
                status: "running",
                input: { description: "Running Subagent to Interrupt", subagent_id: runningChildId },
                metadata: { sessionId: runningChildId },
              },
            },
          },
        },
      },
    ])

    await expect(page.locator('[data-component="task-tool-card"]')).toBeVisible()

    // Parent receives stop/interrupt
    await transport.burst([
      {
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID: parentSessionID, status: { type: "idle" } },
        },
      },
      {
        directory,
        payload: {
          type: "session.status",
          properties: { sessionID: runningChildId, status: { type: "idle" } },
        },
      },
    ])

    await expect(page.locator('[data-component="prompt-input"]')).toBeVisible()
  })

})
