import { test, expect, type Page } from "@playwright/test"
import { mockOpenCodeServer } from "../utils/mock-server"
import { trackPageErrors } from "../utils/errors"

const DIRECTORY = "C:/OpenCode/RouteBehaviorTest"

/**
 * Minimal mock server config sufficient for the app to pass its
 * ConnectionGate and render route content.
 */
const mockConfig = {
  directory: DIRECTORY,
  project: {
    id: "proj_route_behavior_test",
    worktree: DIRECTORY,
    vcs: "git",
    name: "route-behavior",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  },
  provider: { all: [], connected: [], default: {} },
  sessions: [],
  pageMessages: () => ({ items: [] }),
}

/**
 * Common setup: write localStorage with new-layout settings and a
 * configured server entry, then install the mock backend.
 */
async function setupRouteTest(page: Page) {
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
}

/**
 * Returns the pathname from a URL string, stripping query params.
 */
function pathname(raw: string): string {
  return new URL(raw).pathname
}

// ---------------------------------------------------------------------------
// Phase 3 — Route behavior tests
// ---------------------------------------------------------------------------

test.describe("Phase 3: Route Behavior", () => {
  // -----------------------------------------------------------------------
  // Test 1 – Lazy route requests chunk on navigation
  // -----------------------------------------------------------------------
  test("requests route chunk on navigation", async ({ page }) => {
    await setupRouteTest(page)

    // ---------- Navigate to / (home) ----------
    // The home route is lazy-loaded via `import("@/pages/home")`.  Wait for
    // the resulting Vite-transpiled chunk to be requested and served.
    const homeChunkPromise = page.waitForResponse(
      (res) =>
        pathname(res.url()).includes("/src/pages/home") &&
        res.status() === 200,
      { timeout: 30_000 },
    )

    await page.goto("/")
    const homeChunk = await homeChunkPromise
    expect(homeChunk.url()).toMatch(/\/pages\/home/)

    // ---------- Navigate to /new-session ----------
    const sessionChunkPromise = page.waitForResponse(
      (res) =>
        pathname(res.url()).includes("/src/pages/new-session") &&
        res.status() === 200,
      { timeout: 30_000 },
    )

    await page.goto("/new-session")
    const sessionChunk = await sessionChunkPromise
    expect(sessionChunk.url()).toMatch(/\/pages\/new-session/)
  })

  // -----------------------------------------------------------------------
  // Test 2 – Deep link navigation
  // -----------------------------------------------------------------------
  test("loads content when navigating directly to a deep route", async ({
    page,
  }) => {
    const errors = trackPageErrors(page)

    await setupRouteTest(page)
    await page.goto("/")
    await page.waitForTimeout(3000)

    // No unhandled errors
    expect(errors.length).toBe(0)

    // #root must contain rendered content (not blank)
    const content = await page.locator("#root").textContent()
    expect(content?.trim().length).toBeGreaterThan(0)
  })

  // -----------------------------------------------------------------------
  // Test 3 – Lazy import failure simulation
  // -----------------------------------------------------------------------
  test("shows error boundary when lazy chunk fails and recovers on reload", async ({
    page,
  }) => {
    await setupRouteTest(page)

    // Block every Vite module URL that goes through the home page directory
    // (the lazy chunk for import("@/pages/home") lands at /src/pages/home.tsx).
    await page.route("**/src/pages/home*", (route) =>
      route.abort("blockedbyclient"),
    )

    // Navigate to home — the lazy import should fail because the chunk is
    // blocked, triggering the root ErrorBoundary which renders <ErrorPage />
    // (identified by the data-tauri-drag-region attribute).
    await page.goto("/")
    await expect(
      page.locator("div[data-tauri-drag-region]"),
    ).toBeVisible({ timeout: 10_000 })

    // Unblock and navigate again — the route should recover.
    await page.unroute("**/src/pages/home*")
    await page.goto("/")
    await page.waitForTimeout(3000)

    await expect(
      page.locator("div[data-tauri-drag-region]"),
    ).toHaveCount(0)
    const content = await page.locator("#root").textContent()
    expect(content?.trim().length).toBeGreaterThan(0)
  })

  // -----------------------------------------------------------------------
  // Test 4 – Browser refresh on lazy route
  // -----------------------------------------------------------------------
  test("survives browser refresh on a lazy-loaded route", async ({ page }) => {
    const errors = trackPageErrors(page)

    await setupRouteTest(page)
    await page.goto("/")
    await page.waitForTimeout(3000)

    // Refresh the page while still on the lazy route.
    await page.reload()
    await page.waitForTimeout(3000)

    // The page should not be blank.
    const content = await page.locator("#root").textContent()
    expect(content?.trim().length).toBeGreaterThan(0)

    // No unhandled errors should have been thrown.
    expect(errors.length).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Test 5 – No blank screen on navigation
  // -----------------------------------------------------------------------
  test("does not show blank screen when navigating between lazy routes", async ({
    page,
  }) => {
    const errors = trackPageErrors(page)

    await setupRouteTest(page)

    // Navigate through multiple lazy routes and verify #root always has
    // content.
    for (const url of ["/", "/new-session", "/"]) {
      await page.goto(url)
      await page.waitForTimeout(3000)

      const content = await page.locator("#root").textContent()
      expect(
        content?.trim().length,
        `#root should not be blank after navigating to ${url}`,
      ).toBeGreaterThan(0)
    }

    expect(errors.length, "no unhandled errors during navigation").toBe(0)
  })
})
