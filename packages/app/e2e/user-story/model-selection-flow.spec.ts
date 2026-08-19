import { expect, test } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenCode/NewProject"

test("creates a session in a new project, connects OpenCode Go, and selects its model", async ({ page }) => {
  let connectedGo = false
  let pendingGo = false
  const connections: Array<{ integrationID: string; body: unknown }> = []

  await mockOpenCodeServer(page, {
    directory,
    project: {
      id: "proj_model_selection_flow",
      worktree: directory,
      vcs: "git",
      name: "NewProject",
      time: { created: 1_700_000_000_000, updated: 1_700_000_000_000 },
      sandboxes: [],
    },
    provider: () => ({
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: {
            "free-model": {
              id: "free-model",
              name: "Free Model",
              cost: { input: 0, output: 0 },
              limit: { context: 200_000 },
            },
          },
        },
        {
          id: "opencode-go",
          name: "OpenCode Go",
          models: {
            "go-model-1": {
              id: "go-model-1",
              name: "Go Model 1",
              cost: { input: 1, output: 1 },
              limit: { context: 200_000 },
            },
          },
        },
        { id: "obscure-ai", name: "Obscure AI", models: {} },
      ],
      connected: connectedGo ? ["opencode", "opencode-go"] : ["opencode"],
      default: { providerID: "opencode", modelID: "free-model" },
    }),
    integrationMethods: {
      "opencode-go": [{ type: "api", label: "API key" }],
      "obscure-ai": [{ type: "api", label: "API key" }],
    },
    onConnectKey: (input) => {
      connections.push(input)
      if (input.integrationID === "opencode-go") pendingGo = true
    },
    onInstanceDispose: () => {
      if (pendingGo) connectedGo = true
    },
    sessions: [],
    pageMessages: () => ({ items: [] }),
    fileList: (path) =>
      path ? [] : [{ name: "NewProject", path: "NewProject", absolute: directory, type: "directory", ignored: false }],
    findFiles: () => ["NewProject"],
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem("opencode.settings.dat:defaultServerUrl", "http://127.0.0.1:4096")
    localStorage.setItem(
      "opencode.global.dat:server.v4",
      JSON.stringify({
        list: [{ type: "http", http: { id: "model-selection-server", url: "http://127.0.0.1:4096" } }],
        projects: { "http://127.0.0.1:4096": [] },
        lastProject: {},
        recentlyClosed: {},
      }),
    )
  })

  await page.goto("/")
  const newSession = page.getByRole("button", { name: "New session" }).first()
  await expectAppVisible(newSession)
  await newSession.click()
  await expectAppVisible(page.locator('[data-component="prompt-input-v2"]'))

  const modelControl = page.locator('[data-action="prompt-model"]')
  await modelControl.click()
  await expect(page.locator('[data-section="free-models"]')).toContainText("Free models provided by OpenCode")

  await page.getByText("See 70+ more providers").click()
  await expect(page.locator('[data-provider-id="obscure-ai"]')).toBeVisible()
  await page.locator('[data-provider-id="opencode-go"]').click()
  await page.locator('[data-input="provider-api-key"]').fill("mock-go-api-key")
  await page.locator('[data-action="provider-connect-submit"]').click()
  await expect(page.locator('[data-component="dialog-v2"]')).toHaveCount(0)
  expect(connections).toEqual([{ integrationID: "opencode-go", body: { type: "api", key: "mock-go-api-key" } }])

  await expect(modelControl).toHaveAttribute("data-control-type", "popover")
  await modelControl.click()
  const goModel = page.locator('[data-option-key="opencode-go:go-model-1"]')
  await expect(goModel).toBeVisible()
  await goModel.focus()
  await goModel.press("Enter")

  await expect(modelControl).toContainText("Go Model 1")
})
