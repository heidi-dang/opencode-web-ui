import config from "../playwright.config"

const port = Number(process.env.PLAYWRIGHT_STABILITY_PORT ?? 4174)
const baseURL = process.env.PLAYWRIGHT_STABILITY_BASE_URL ?? `http://127.0.0.1:${port}`

export default {
  ...config,
  testDir: ".",
  testMatch: "**/*.spec.ts",
  webServer: {
    command: `WEBUI_PORT=${port} bun run serve`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...config.webServer?.env,
      WEBUI_PORT: String(port),
    },
  },
  outputDir: "../../test-results/timeline-stability",
  reporter: [["html", { outputFolder: "../../playwright-report/timeline-stability", open: "never" }], ["line"]],
  retries: 0,
  workers: 1,
  use: {
    ...config.use,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
}
