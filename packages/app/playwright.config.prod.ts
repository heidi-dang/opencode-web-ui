import { defineConfig, devices } from "@playwright/test"
import { createServer } from "net"

/**
 * Find a free TCP port on 127.0.0.1. This avoids fixed-default-port conflicts
 * when multiple CI jobs or local processes run concurrently.
 */
async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as import("net").AddressInfo).port
      server.close(() => resolve(port))
    })
    server.on("error", reject)
  })
}

// Ports: use explicit env-var overrides in CI; fall back to a dynamic port
// so local runs never clash with other processes on 4173 or 4096.
const port = Number(process.env.PLAYWRIGHT_PORT ?? 0) || (await getFreePort())
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`
const serverHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"
// Bind preview only to localhost per security requirement
const command = `bun run serve -- --host 127.0.0.1 --port ${port}`
const reuse = !process.env.CI

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/phase-3/production-network*",
  outputDir: "./e2e/test-results",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["html", { outputFolder: "e2e/playwright-report-prod", open: "never" }], ["line"]],
  webServer: {
    command,
    url: baseURL,
    reuseExistingServer: reuse,
    timeout: 120_000,
    env: {
      VITE_OPENCODE_SERVER_HOST: serverHost,
      VITE_OPENCODE_SERVER_PORT: process.env.PLAYWRIGHT_SERVER_PORT ?? "4096",
    },
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
