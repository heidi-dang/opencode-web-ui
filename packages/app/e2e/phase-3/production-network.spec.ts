import { test, expect, type Page } from "@playwright/test"
import { readFileSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
import { mockOpenCodeServer } from "../utils/mock-server"
import { trackPageErrors } from "../utils/errors"

const DIRECTORY = "C:/OpenCode/ProdNetworkTest"

const mockConfig = {
  directory: DIRECTORY,
  project: {
    id: "proj_prod_network_test",
    worktree: DIRECTORY,
    vcs: "git",
    name: "prod-network",
    time: { created: 1700000000000, updated: 1700000000000 },
    sandboxes: [],
  },
  provider: { all: [], connected: [], default: {} },
  sessions: [],
  pageMessages: () => ({ items: [] }),
}

// ---------------------------------------------------------------------------
// Read production manifest once at import time to resolve hashed chunk names.
// Chunk filenames contain content hashes that change between builds, so we
// must NOT hardcode them — resolve everything through manifest.json.
// ---------------------------------------------------------------------------
const distRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const manifest: Record<
  string,
  { file: string; css?: string[]; isEntry?: boolean; isDynamicEntry?: boolean; imports?: string[] }
> = (() => {
  try {
    return JSON.parse(readFileSync(resolve(distRoot, "dist/.vite/manifest.json"), "utf-8"))
  } catch (cause) {
    throw new Error(
      "Production manifest not found at dist/.vite/manifest.json. " +
        "Run 'bun run build' before running production network tests.",
      { cause },
    )
  }
})()

/**
 * Resolve a Vite-internal module path to its production URL path.
 *
 * Examples:
 *   moduleUrl("index.html")          => "/assets/index-D_XThmOM.js"
 *   moduleUrl("src/pages/home.tsx")  => "/assets/home-ChqzjH_B.js"
 */
function moduleUrl(modulePath: string): string {
  const entry = manifest[modulePath]
  if (!entry) {
    const sample = Object.keys(manifest)
      .slice(0, 10)
      .join(", ")
    throw new Error(
      `Module "${modulePath}" not found in production manifest. ` +
        `Available keys include: [${sample}, ...]`,
    )
  }
  return `/${entry.file}`
}

/**
 * Find a manifest key matching a regex pattern and return its URL path.
 * This is needed for Vite-internal chunk names like `_session-CbCThe_z.js`
 * which contain content hashes that change between builds.
 */
function findDynamicEntryUrl(pattern: RegExp): string {
  for (const [key, entry] of Object.entries(manifest)) {
    if (pattern.test(key) && entry.isDynamicEntry) {
      return `/${entry.file}`
    }
  }
  throw new Error(
    `No dynamic entry found matching pattern ${pattern}. Available keys include: [${Object.keys(manifest).slice(0, 10).join(", ")}, ...]`,
  )
}

function pathname(raw: string): string {
  return new URL(raw).pathname
}

// ---------------------------------------------------------------------------
// Resolve well-known chunk URLs from the manifest. These are computed once
// at import time so the tests never hardcode generated filenames.
// ---------------------------------------------------------------------------
const ENTRY_CHUNK = moduleUrl("index.html")
const HOME_CHUNK = moduleUrl("src/pages/home.tsx")
const NEW_SESSION_CHUNK = moduleUrl("src/pages/new-session.tsx")
// Session chunk is created by Vite for lazy(() => import("@/pages/session"))
// The key follows the pattern _session-<hash>.js, so we find it dynamically.
const SESSION_CHUNK = findDynamicEntryUrl(/^_session-[a-zA-Z0-9_-]+\.js$/)

// Static imports of the entry chunk — these are the chunks preloaded via
// <link rel="modulepreload"> in the initial HTML. Without manualChunks this
// list is typically empty; with vendor extraction it contains vendor splits.
const STATIC_IMPORTS = (manifest["index.html"]?.imports ?? [])
  .map((imp: string) => manifest[imp])
  .filter(Boolean)
  .map((v: { file: string }) => `/${v.file}`)

// ---------------------------------------------------------------------------
// Common setup — shared by all tests
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Phase 3 — Production Network tests
//
// These tests validate that the production build:
//   1. Splits routes into separate JS chunks (entry + vendors vs route chunks)
//   2. Loads route chunks on-demand (lazy loading)
//   3. Survives hard refreshes on lazy routes
//   4. Shows an error boundary when a lazy chunk fails, with retry recovery
// ---------------------------------------------------------------------------
test.describe("Phase 3: Production Network", () => {
  // -----------------------------------------------------------------------
  // Test 1 – Initial JS requests exclude deferred route chunks
  //
  // The production build should only load the entry chunk and its static
  // vendor imports on initial page load. Route chunks (session, new-session)
  // must NOT be requested until the user navigates to those routes.
  // -----------------------------------------------------------------------
  test("initial JS requests exclude deferred route chunks", async ({ page }) => {
    const errors = trackPageErrors(page)

    // Collect JS request URLs before navigation
    const jsRequests: string[] = []
    page.on("request", (req) => {
      const url = req.url()
      if (url.endsWith(".js") || url.endsWith(".mjs")) {
        jsRequests.push(pathname(url))
      }
    })

    await setupTest(page)
    await page.goto("/")

    // Wait for the page to render meaningful content
    await expect(async () => {
      const text = await page.locator("#root").textContent()
      expect(text?.trim().length).toBeGreaterThan(0)
    }).toPass({ timeout: 15_000 })

    // Entry chunk must always be in the initial request set
    expect(
      jsRequests,
      "entry chunk must be requested on initial page load",
    ).toContain(ENTRY_CHUNK)

    // Static imports of the entry (if any) should be in the request set.
    // Without manualChunks this list is empty; with vendor extraction it
    // contains vendor chunks that are modulepreloaded.
    for (const imp of STATIC_IMPORTS) {
      expect(
        jsRequests,
        `static import ${imp} must be requested on initial page load`,
      ).toContain(imp)
    }

    // Deferred route chunks must NOT be in the initial request set.
    // These belong to different routes and should only load on navigation.
    expect(
      jsRequests,
      "session chunk must NOT be loaded on home page",
    ).not.toContain(SESSION_CHUNK)

    expect(
      jsRequests,
      "new-session chunk must NOT be loaded on home page",
    ).not.toContain(NEW_SESSION_CHUNK)

    expect(errors.length, "no unhandled errors during initial page load").toBe(0)
  })

  // -----------------------------------------------------------------------
  // Test 2 – Navigation loads the correct hashed route chunk
  //
  // When navigating to a lazy route, the production build should request
  // the correct hashed chunk for that route. We verify this by resolving
  // the expected chunk URL through manifest.json.
  // -----------------------------------------------------------------------
  test("loads correct hashed chunk when navigating to lazy route", async ({ page }) => {
    const errors = trackPageErrors(page)
    await setupTest(page)

    // ---------- Navigate to home (/) ----------
    const homeChunkPromise = page.waitForResponse(
      (res) => pathname(res.url()) === HOME_CHUNK && res.status() === 200,
      { timeout: 30_000 },
    )

    await page.goto("/")
    const homeChunk = await homeChunkPromise
    expect(
      pathname(homeChunk.url()),
      "home route must use the manifest-resolved chunk URL",
    ).toBe(HOME_CHUNK)

    // ---------- Navigate to new-session (/new-session) ----------
    const newSessionChunkPromise = page.waitForResponse(
      (res) => pathname(res.url()) === NEW_SESSION_CHUNK && res.status() === 200,
      { timeout: 30_000 },
    )

    await page.goto("/new-session")
    const newSessionChunk = await newSessionChunkPromise
    expect(
      pathname(newSessionChunk.url()),
      "new-session route must use the manifest-resolved chunk URL",
    ).toBe(NEW_SESSION_CHUNK)

    expect(errors.length, "no unhandled errors during route navigation").toBe(0)
  })

  // -----------------------------------------------------------------------
  // Test 3 – Hard refresh on a lazy-loaded route
  //
  // After navigating to a lazy route, a browser hard refresh should still
  // render the page correctly (not a blank screen).
  // -----------------------------------------------------------------------
  test("survives hard refresh on lazy route", async ({ page }) => {
    const errors = trackPageErrors(page)
    await setupTest(page)

    await page.goto("/")

    // Wait for the first render
    await expect(async () => {
      const text = await page.locator("#root").textContent()
      expect(text?.trim().length).toBeGreaterThan(0)
    }).toPass({ timeout: 15_000 })

    // Hard refresh the page
    await page.reload()

    // After refresh, the page must still render content
    await expect(async () => {
      const text = await page.locator("#root").textContent()
      expect(
        text?.trim().length,
        "#root must not be blank after hard refresh on lazy route",
      ).toBeGreaterThan(0)
    }).toPass({ timeout: 15_000 })

    expect(errors.length, "no unhandled errors during hard refresh").toBe(0)
  })

  // -----------------------------------------------------------------------
  // Test 4 – Block lazy chunk → error fallback → unblock → retry recovery
  //
  // When a lazy chunk fails to load (e.g., network interruption), the error
  // boundary must show a retry fallback. After unblocking the chunk and
  // clicking retry, the page should recover and render normally.
  // -----------------------------------------------------------------------
  test("shows error fallback when lazy chunk fails and recovers on retry", async ({
    page,
  }) => {
    const errors = trackPageErrors(page)

    // Block the session chunk so the SessionRouteErrorBoundary handles it
    // (shows Retry). Blocking the home chunk would be caught by the root
    // ErrorBoundary which shows Restart, not Retry.
    await page.route(`**${SESSION_CHUNK}`, (route) => route.abort("blockedbyclient"))
    // Navigate to the session route so the session chunk is requested
    await page.goto("/")

    await setupTest(page)
    await page.goto("/")

    // The error boundary should render, showing a retry button
    const retryButton = page.getByRole("button", { name: /retry/i })
    await expect(
      retryButton,
      "retry button must appear when lazy chunk fails",
    ).toBeVisible({ timeout: 20_000 })

    // Unblock the chunk so the retry can succeed
    await page.unroute(`**${SESSION_CHUNK}`)

    // Click retry
    await retryButton.click()

    // After recovery, the retry button must disappear and #root must have content
    await expect(
      retryButton,
      "retry button must disappear after successful recovery",
    ).not.toBeVisible({ timeout: 15_000 })

    const content = await page.locator("#root").textContent()
    expect(
      content?.trim().length,
      "#root must render content after retry recovery",
    ).toBeGreaterThan(0)

    expect(errors.length, "no unhandled errors during chunk failure and retry").toBe(
      0,
    )
  })
})
