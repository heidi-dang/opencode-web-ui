import { expect, test, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/RemoteCustomProvider"
const projectID = "proj_remote_custom_provider"
const sessionID = "ses_remote_custom_provider"
const title = "Remote Custom Provider"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

test.describe("remote-opencode-custom-provider", () => {
  let configUpdates: Array<Record<string, unknown>> = []
  let integrationKeys: Array<{ integrationID: string; body: unknown }> = []
  let legacyAuthKeys: Array<{ providerID: string; body: unknown }> = []

  test.beforeEach(async ({ page }) => {
    configUpdates = []
    integrationKeys = []
    legacyAuthKeys = []

    await mockOpenCodeServer(page, {
      protocol: "v2",
      directory,
      project: {
        id: projectID,
        worktree: directory,
        vcs: "git",
        name: "remote-custom-provider",
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
      globalConfig: { provider: {} },
      onGlobalConfigUpdate: (config) => {
        configUpdates.push(config)
      },
      onIntegrationConnectKey: (input) => {
        integrationKeys.push(input)
      },
      onConnectKey: (input) => {
        legacyAuthKeys.push(input)
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

  test("V2 session model selector displays backend provider models", async ({ page }) => {
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const modelButton = page.locator('[data-action="prompt-model"]')
    await expect(modelButton).toBeVisible()
    await expect(modelButton).toContainText("OpenCode Build Model")

    await modelButton.click()
    // The OpenCode backend exposes a free model, so the V2 selector opens the
    // unpaid model dialog listing backend provider models.
    const modelOption = page.locator('[data-section="free-models"] button').filter({ hasText: "OpenCode Build Model" })
    await expect(modelOption).toBeVisible()
  })

  test("Custom provider action is available for supported V2 backend", async ({ page }) => {
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes("MAC"))
    await page.keyboard.press(isMac ? "Meta+," : "Control+,")

    const providersTab = page.locator('[data-slot="tabs-v2-trigger"][data-value="providers"]')
    await expect(providersTab).toBeVisible()
    await providersTab.click()

    const customSection = page.locator('[data-component="custom-provider-section"]')
    await expect(customSection).toBeVisible()

    await customSection.getByRole("button", { name: /connect/i }).click()
    await expect(page.getByText("Custom provider", { exact: true })).toBeVisible()
    await expect(page.getByRole("textbox", { name: /api key/i })).toBeVisible()
  })

  test("V2 custom provider creation stores config on backend and credential via integration.connect.key", async ({ page }) => {
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const isMac = await page.evaluate(() => navigator.platform.toUpperCase().includes("MAC"))
    await page.keyboard.press(isMac ? "Meta+," : "Control+,")
    const providersTab = page.locator('[data-slot="tabs-v2-trigger"][data-value="providers"]')
    await expect(providersTab).toBeVisible()
    await providersTab.click()
    await page.locator('[data-component="custom-provider-section"]').getByRole("button", { name: /connect/i }).click()

    await page.getByRole("textbox", { name: /provider id/i }).fill("mycustom")
    await page.getByRole("textbox", { name: /display name/i }).fill("My Custom")
    await page.getByRole("textbox", { name: /base url/i }).fill("http://myprovider.test/v1")
    await page.getByRole("textbox", { name: /api key/i }).fill("sk-custom-test-999")

    // Model rows (one row by default)
    const modelId = page.getByRole("textbox", { name: /^id/i }).first()
    const modelName = page.getByRole("textbox", { name: /^name/i }).first()
    await modelId.fill("my-model-1")
    await modelName.fill("My Model One")

    const submit = page.getByRole("button", { name: /submit/i })
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect.poll(() => configUpdates.length).toBeGreaterThan(0)

    // Config persisted on the backend
    await expect.poll(() => configUpdates.length).toBeGreaterThan(0)
    const config = configUpdates[configUpdates.length - 1]!
    expect(config.provider).toMatchObject({
      mycustom: expect.objectContaining({
        name: "My Custom",
        npm: "@ai-sdk/openai-compatible",
        options: expect.objectContaining({ baseURL: "http://myprovider.test/v1" }),
        models: expect.objectContaining({ "my-model-1": expect.objectContaining({ name: "My Model One" }) }),
      }),
    })
    // Credential submitted through the canonical integration API (not browser storage)
    await expect.poll(() => integrationKeys.length).toBe(1)
    expect(integrationKeys[0]).toMatchObject({
      integrationID: "mycustom",
      body: expect.objectContaining({ key: "sk-custom-test-999" }),
    })

    // The new provider/model appears in the session model selector without reload
    const modelButton = page.locator('[data-action="prompt-model"]')
    await expect(modelButton).toBeVisible()
    await modelButton.click()
    const newModelOption = page
      .locator('[role="menuitemradio"]')
      .filter({ hasText: "My Model One" })
      .first()
    await expect(newModelOption).toBeVisible()
    await page.keyboard.press("Escape")

    // No raw key persisted to browser storage
    const leaked = await page.evaluate(() => {
      let found: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!
        const value = localStorage.getItem(key) ?? ""
        if (value.includes("sk-custom-test-999")) found.push(key)
      }
      try {
        for (const key of Object.keys(sessionStorage)) {
          if ((sessionStorage.getItem(key) ?? "").includes("sk-custom-test-999")) found.push(`session:${key}`)
        }
      } catch {}
      return found
    })
    expect(leaked).toEqual([])
  })
})
