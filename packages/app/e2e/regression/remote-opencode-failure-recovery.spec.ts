import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { installSseTransport } from "../utils/sse-transport"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/FailureRecovery"
const projectID = "proj_failure_recovery"
const sessionID = "ses_failure_recovery"
const title = "Failure Recovery Workspace"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.describe("remote-opencode-failure-recovery", () => {
  let isHealthy = true
  let failPromptsWith429 = false
  let promptsReceived: Array<{ sessionID: string; body: unknown }> = []

  test.beforeEach(async ({ page }) => {
    isHealthy = true
    failPromptsWith429 = false
    promptsReceived = []

    await installSseTransport(page, { server, retry: 50 })

    await mockOpenCodeServer(page, {
      protocol: "v2",
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "failure-recovery",
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
      healthy: () => isHealthy,
      healthState: () => (isHealthy ? "READY" : "UNHEALTHY"),
      statusOverride: (path, method) => {
        if (failPromptsWith429 && path.includes("/prompt") && method === "POST") {
          return { status: 429, body: { error: "Provider rate limit exceeded (429)" } }
        }
        if (!isHealthy && (path.includes("/health") || path.startsWith("/servers/"))) {
          return { status: 503, body: { error: "Service Unavailable", state: "UNHEALTHY" } }
        }
        return undefined
      },
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

  test("handles provider 429 rate limit without marking server offline", async ({ page }) => {
    failPromptsWith429 = true

    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const composer = page.locator('[data-component="prompt-input"]')
    await expect(composer).toBeVisible()

    await composer.click()
    await page.keyboard.type("Trigger rate limit")
    await page.getByRole("button", { name: "Send" }).click()

    // 429 error toast appears
    await expect(page.getByText(/rate limit/i)).toBeVisible()

    // Server remains accessible and composer stays active
    await expect(composer).toBeVisible()
  })

  test("quarantines malformed SSE event without terminating the event stream", async ({ page }) => {
    const transport = await installSseTransport(page, { server, retry: 50 })
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await transport.waitForConnection()
    await expectSessionTitle(page, title)

    // Inject malformed raw SSE data
    await transport.writeRaw("data: {corrupted_json: [invalid\n\n")

    // Then send valid event
    const msgU = "msg_user_after_corrupt"
    const msgA = "msg_asst_after_corrupt"
    await transport.burst([
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
          properties: { part: { id: "p_u_c", messageID: msgU, sessionID, type: "text", text: "Post-corrupt message" } },
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
          properties: { part: { id: "p_a_c", messageID: msgA, sessionID, type: "text", text: "Successfully processed after quarantined event." } },
        },
      },
    ])

    await expect(page.getByText("Successfully processed after quarantined event.")).toBeVisible()
  })

  test("recovers from 503 UNHEALTHY state back to READY without page reload", async ({ page }) => {
    const transport = await installSseTransport(page, { server, retry: 50 })
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await transport.waitForConnection()
    await expectSessionTitle(page, title)

    // Induce temporary 503 outage
    isHealthy = false
    await transport.disconnect("Simulated backend restart outage")

    // Backend recovers
    isHealthy = true

    // Wait for automatic reconnect to succeed
    const connRecovered = await transport.waitForConnection({ timeout: 20_000 })
    expect(connRecovered.endedAt).toBeUndefined()

    // Submit prompt after recovery
    const composer = page.locator('[data-component="prompt-input"]')
    await expect(composer).toBeVisible()
    await composer.click()
    const promptText = "Prompt after server recovery"
    await page.keyboard.type(promptText)
    await page.getByRole("button", { name: "Send" }).click()

    await expect.poll(() => promptsReceived.length).toBe(1)
  })
})
