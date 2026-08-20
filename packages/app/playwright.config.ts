import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineConfig, devices } from "@playwright/test"

// E2E fixtures own their browser-side server registry. Keep the control plane
// isolated from the checkout's developer database/legacy registry so a stale
// real backend cannot replace the fixture server during bootstrap.
const e2eRuntimeDir = mkdtempSync(join(tmpdir(), "opencode-web-ui-e2e-"))
const e2eControlPlaneDb = join(e2eRuntimeDir, "control-plane.sqlite")
const e2eLegacyRegistry = join(e2eRuntimeDir, "opencode-servers.json")
writeFileSync(e2eLegacyRegistry, JSON.stringify({ version: 1, servers: [] }))

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`
const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"
const serverPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
const command = `bun run dev -- --host 0.0.0.0 --port ${port}`
const reuse = process.env.PLAYWRIGHT_REUSE_SERVER === "1"
const workers = Number(process.env.PLAYWRIGHT_WORKERS ?? (process.env.CI ? 5 : 0)) || undefined
export default defineConfig({
  testDir: "./e2e",
  testIgnore: process.env.OPENCODE_PERFORMANCE === "1" ? "performance/**/*.test.ts" : "performance/**",
  outputDir: "./e2e/test-results",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: process.env.PLAYWRIGHT_FULLY_PARALLEL === "1",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers,
  reporter: [["html", { outputFolder: "e2e/playwright-report", open: "never" }], ["line"]],
  webServer: {
    command,
    url: baseURL,
    reuseExistingServer: reuse,
    timeout: 120_000,
    env: {
      VITE_OPENCODE_SERVER_HOST: serverHost,
      VITE_OPENCODE_SERVER_PORT: serverPort,
      CONTROL_PLANE_DB: e2eControlPlaneDb,
      OPENCODE_SERVERS_STORE: e2eLegacyRegistry,
      OPENCODE_SERVERS_CONFIG: "[]",
    },
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
})
