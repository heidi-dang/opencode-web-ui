import { test, expect, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { trackPageErrors } from "../utils/errors"
import { base64Encode } from "@opencode-ai/core/util/encode"

const DIRECTORY = "C:/OpenCode/DataContextRegressionTest"
const ENCODED_DIR = base64Encode(DIRECTORY)
const SESSION_ID = "sess_data_ctx_regression_001"
const SERVER_KEY = "test-server-key"

const mockConfig = {
  directory: DIRECTORY,
  project: {
    id: "proj_data_ctx_regression",
    worktree: DIRECTORY,
    vcs: "git",
    name: "data-ctx-regression",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  },
  provider: { all: [], connected: [], default: {} },
  sessions: [{ id: SESSION_ID, title: "Regression Test Session" }],
  pageMessages: () => ({ items: [] }),
}

async function setupTest(page: Page) {
  await page.addInitScript(
    ({ directory }) => {
      localStorage.setItem(
        "settings.v3",
        JSON.stringify({ general: { newLayoutDesigns: true } }),
      )
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
    },
    { directory: DIRECTORY },
  )
  await mockOpenCodeServer(page, mockConfig)
}

const DATA_CONTEXT_ERROR =
  "Data context must be used within a context provider"

test.describe("Session Data Context Provider Regression", () => {
  test("legacy session route renders without Data context error", async ({
    page,
  }) => {
    const errors = trackPageErrors(page)
    await setupTest(page)

    const sessionUrl = "/" + ENCODED_DIR + "/session/" + SESSION_ID
    await page.goto(sessionUrl)

    await expect(async () => {
      const text = await page.locator("#root").textContent()
      expect(text?.trim().length).toBeGreaterThan(0)
    }).toPass({ timeout: 15_000 })

    const dataContextErrors = errors.filter((e) =>
      e.includes(DATA_CONTEXT_ERROR),
    )
    expect(
      dataContextErrors,
      "legacy session route must not throw Data context error",
    ).toHaveLength(0)
  })

  test("target-server session route renders without Data context error", async ({
    page,
  }) => {
    const errors = trackPageErrors(page)
    await setupTest(page)

    const encodedServerKey = base64Encode(SERVER_KEY)
    const sessionUrl = "/server/" + encodedServerKey + "/session/" + SESSION_ID
    await page.goto(sessionUrl)

    await page.waitForTimeout(5000)

    const dataContextErrors = errors.filter((e) =>
      e.includes(DATA_CONTEXT_ERROR),
    )
    expect(
      dataContextErrors,
      "target-server session route must not throw Data context error",
    ).toHaveLength(0)
  })

  test("draft route renders without Data context error", async ({ page }) => {
    const errors = trackPageErrors(page)
    await setupTest(page)

    await page.goto("/new-session?draftId=draft_regression_001")

    await page.waitForTimeout(5000)

    const dataContextErrors = errors.filter((e) =>
      e.includes(DATA_CONTEXT_ERROR),
    )
    expect(
      dataContextErrors,
      "draft route must not throw Data context error",
    ).toHaveLength(0)
  })

  test("hard refresh on session route succeeds without Data context error", async ({
    page,
  }) => {
    const errors = trackPageErrors(page)
    await setupTest(page)

    const sessionUrl = "/" + ENCODED_DIR + "/session/" + SESSION_ID
    await page.goto(sessionUrl)

    await expect(async () => {
      const text = await page.locator("#root").textContent()
      expect(text?.trim().length).toBeGreaterThan(0)
    }).toPass({ timeout: 15_000 })

    await page.reload()

    await expect(async () => {
      const text = await page.locator("#root").textContent()
      expect(text?.trim().length).toBeGreaterThan(0)
    }).toPass({ timeout: 15_000 })

    const dataContextErrors = errors.filter((e) =>
      e.includes(DATA_CONTEXT_ERROR),
    )
    expect(
      dataContextErrors,
      "hard refresh on session route must not throw Data context error",
    ).toHaveLength(0)
  })

  test("session navigation callbacks are wired correctly", async ({ page }) => {
    const errors = trackPageErrors(page)
    await setupTest(page)

    const sessionUrl = "/" + ENCODED_DIR + "/session/" + SESSION_ID
    await page.goto(sessionUrl)

    await expect(async () => {
      const text = await page.locator("#root").textContent()
      expect(text?.trim().length).toBeGreaterThan(0)
    }).toPass({ timeout: 15_000 })

    const dataContextErrors = errors.filter((e) =>
      e.includes(DATA_CONTEXT_ERROR),
    )
    expect(
      dataContextErrors,
      "session page must render without Data context errors",
    ).toHaveLength(0)

    expect(errors, "no unhandled errors during session render").toHaveLength(0)
  })
})
