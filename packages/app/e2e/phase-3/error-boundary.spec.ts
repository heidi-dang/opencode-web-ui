import { test, expect, type Page } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { trackPageErrors } from "../utils/errors"

const DIRECTORY = "C:/OpenCode/ErrorBoundaryTest"
const SERVER_KEY = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
const SESSION_ID = "test-session-id"

// ---------------------------------------------------------------------------
// Mock server config — enough for the app to pass ConnectionGate and render
// ---------------------------------------------------------------------------

const mockConfig = {
  directory: DIRECTORY,
  project: {
    id: "proj_error_boundary_test",
    worktree: DIRECTORY,
    vcs: "git",
    name: "error-boundary-test",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  },
  provider: { all: [], connected: [], default: {} },
  sessions: [
    {
      id: SESSION_ID,
      title: "Test Session",
      agent: "build",
      directory: DIRECTORY,
      time: { created: 1700000000000, updated: 1700000000001 },
    },
  ],
  pageMessages: () => ({ items: [] }),
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

/**
 * Common setup for tests that navigate to the legacy session route
 * with newLayoutDesigns enabled.  The route /:dir/session (no ID)
 * does not trigger the new-layout redirect, so the
 * SessionRouteErrorBoundary wraps SessionPage directly.
 */
async function setupRouteTest(page: Page) {
  const errors = trackPageErrors(page)

  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true } }),
    )
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: DIRECTORY, expanded: true }] },
        lastProject: { local: DIRECTORY },
      }),
    )
  })

  await mockOpenCodeServer(page, mockConfig)

  return errors
}

/**
 * Setup for the target-session-route-based tests.  The app navigates
 * to /server/<base64-key>/session/<id> which renders the
 * TargetSessionRoute (with newLayoutDesigns enabled and the session ID
 * set on the error boundary).
 */
async function setupTargetRouteTest(page: Page) {
  const errors = trackPageErrors(page)

  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({ general: { newLayoutDesigns: true } }),
    )
    localStorage.setItem(
      "opencode.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: DIRECTORY, expanded: true }] },
        lastProject: { local: DIRECTORY },
      }),
    )
  })

  // Use v2 protocol so the session resolve hits the /api/session/:id
  // endpoint (which the mock server answers with 404 for unknown sessions).
  await mockOpenCodeServer(page, {
    ...mockConfig,
    protocol: "v2",
    sessions: [], // deliberately empty — session will not be found
  })

  return errors
}

/**
 * The base64-encoded server key used in target-session-route URLs.
 */
const serverKeyBase64 = base64Encode(SERVER_KEY)

// ---------------------------------------------------------------------------
// Phase 3 — Error Boundary tests
// ---------------------------------------------------------------------------

test.describe("Phase 3: Error Boundaries", () => {
  // -----------------------------------------------------------------------
  // Test 1 – Generic error fallback (chunk load failure)
  // -----------------------------------------------------------------------
  test("shows generic error fallback when session chunk fails to load", async ({
    page,
  }) => {
    const errors = setupRouteTest(page)

    // Block the lazy-loaded session module
    await page.route("**/src/pages/session.tsx*", (route) =>
      route.abort("blockedbyclient"),
    )

    // Navigate to /:dir/session (no ID) — does NOT redirect
    await page.goto(`/${base64Encode(DIRECTORY)}/session`)

    // The ErrorBoundary should catch the chunk error — wait for the
    // generic session error title.
    await expect(
      page.getByText("Session error"),
    ).toBeVisible({ timeout: 15_000 })

    // Verify the fallback description is shown
    await expect(
      page.getByText("An error occurred"),
    ).toBeVisible({ timeout: 5_000 })

    // No unhandled page errors (the error was caught by the boundary)
    expect(errors.length).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Test 2 – Session-not-found fallback (via target session route)
  // -----------------------------------------------------------------------
  test("shows session-not-found fallback for a missing session", async ({
    page,
  }) => {
    const errors = setupTargetRouteTest(page)

    // Navigate directly to the target session route.
    // The mock server has no sessions configured, so when the app tries
    // to resolve this session the API returns a 404.
    const targetUrl = `/server/${serverKeyBase64}/session/${SESSION_ID}`
    await page.goto(targetUrl)

    // The SessionRouteErrorBoundary inside TargetSessionRouteContent
    // should catch the not-found error and render the specific fallback.
    await expect(
      page.getByText("This session cannot be found"),
    ).toBeVisible({ timeout: 20_000 })

    // The description should also be shown
    await expect(
      page.getByText("This tab points to a session that no longer exists on this server."),
    ).toBeVisible({ timeout: 5_000 })

    expect(errors.length).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Test 3 – Retry button rendering
  // -----------------------------------------------------------------------
  test("renders a retry button in the error fallback", async ({ page }) => {
    const errors = setupRouteTest(page)

    await page.route("**/src/pages/session.tsx*", (route) =>
      route.abort("blockedbyclient"),
    )

    await page.goto(`/${base64Encode(DIRECTORY)}/session`)

    // Wait for the error fallback
    await expect(
      page.getByText("Session error"),
    ).toBeVisible({ timeout: 15_000 })

    // The transient error state renders a "Retry start" button
    const retryButton = page.getByRole("button", { name: /retry/i })
    await expect(retryButton).toBeVisible({ timeout: 5_000 })

    expect(errors.length).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Test 4 – Retry callback clears the error
  // -----------------------------------------------------------------------
  test("clicking retry clears the error and re-renders content", async ({
    page,
  }) => {
    const errors = setupRouteTest(page)

    // First: block the session chunk to trigger the error
    await page.route("**/src/pages/session.tsx*", (route) =>
      route.abort("blockedbyclient"),
    )

    await page.goto(`/${base64Encode(DIRECTORY)}/session`)

    // Wait for the error fallback to appear
    await expect(
      page.getByText("Session error"),
    ).toBeVisible({ timeout: 15_000 })

    // Unblock the session chunk so subsequent loads succeed
    await page.unroute("**/src/pages/session.tsx*")

    // Click the retry button
    const retryButton = page.getByRole("button", { name: /retry/i })
    await retryButton.click()

    // After reset, the ErrorBoundary re-renders the children.
    // The session chunk now loads successfully, so the session page
    // should try to render.  At minimum the error text should vanish.
    await expect(
      page.getByText("Session error"),
    ).not.toBeVisible({ timeout: 10_000 })

    expect(errors.length).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Test 5 – Successful render after error recovery
  // -----------------------------------------------------------------------
  test("recovers and renders session content after retry", async ({
    page,
  }) => {
    const errors = setupRouteTest(page)

    // First: block to trigger error
    await page.route("**/src/pages/session.tsx*", (route) =>
      route.abort("blockedbyclient"),
    )

    await page.goto(`/${base64Encode(DIRECTORY)}/session`)

    // Wait for error fallback
    await expect(
      page.getByText("Session error"),
    ).toBeVisible({ timeout: 15_000 })

    // Unblock and retry
    await page.unroute("**/src/pages/session.tsx*")
    const retryButton = page.getByRole("button", { name: /retry/i })
    await retryButton.click()

    // After recovery, the #root container should have real content
    // (no error page).  Wait for the content to not be the error text.
    await expect(
      page.getByText("Session error"),
    ).not.toBeVisible({ timeout: 10_000 })

    // The page should render something — at least a non-empty #root
    const content = await page.locator("#root").textContent()
    expect(content?.trim().length).toBeGreaterThan(0)

    expect(errors.length).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Test 6 – Close-tab action for session-not-found
  // -----------------------------------------------------------------------
  test("provides a close-tab button that navigates away for not-found errors", async ({
    page,
  }) => {
    const errors = setupTargetRouteTest(page)

    const targetUrl = `/server/${serverKeyBase64}/session/${SESSION_ID}`
    await page.goto(targetUrl)

    // Wait for the not-found fallback
    await expect(
      page.getByText("This session cannot be found"),
    ).toBeVisible({ timeout: 20_000 })

    // The Close Tab button should be rendered
    const closeTabButton = page.getByRole("button", { name: /close tab/i })
    await expect(closeTabButton).toBeVisible({ timeout: 5_000 })

    // Click it — the app should navigate away from the session route
    // (either to home or somewhere else entirely).
    await Promise.all([
      // Wait for the URL to change to anything other than the session route
      page.waitForURL((url) => !url.pathname.includes(`/session/${SESSION_ID}`), {
        timeout: 15_000,
      }),
      closeTabButton.click(),
    ])

    expect(errors.length).toBe(0)
  })
})
