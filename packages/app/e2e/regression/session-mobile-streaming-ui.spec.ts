import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  session,
  setupTimeline,
  shell,
  textPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "no-preference" })

test("keeps live status and shell tools usable in a phone viewport", async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text())
  })
  page.on("pageerror", (error) => consoleErrors.push(error.message))

  await setupTimeline(page, {
    viewport: { width: 390, height: 844 },
    settings: { newLayoutDesigns: true, shellToolPartsExpanded: true },
    sessions: [
      session({
        cost: 1.2345,
        tokens: { input: 7_000_000, output: 100_000, reasoning: 951, cache: { read: 0, write: 0 } },
      }),
    ],
    messages: [
      userMessage(),
      assistantMessage(
        [
          shell(
            "prt_mobile_shell",
            "running",
            "Streaming output remains readable on a phone viewport.",
            "printf 'a deliberately long mobile command that must wrap without widening the page'",
          ),
          textPart("prt_mobile_text", "Streaming remains anchored below the active shell."),
        ],
        { completed: false },
      ),
    ],
  })

  const status = page.locator('[data-component="streaming-status-bar"]')
  const telemetry = status.locator(".streaming-status-telemetry")
  const waveform = status.locator('[data-component="model-activity-waveform"]')
  const shellTool = page.locator('[data-timeline-part-id="prt_mobile_shell"]')
  await expect(status).toBeVisible()
  await expect(telemetry).toBeVisible()
  await expect(waveform).toBeVisible()
  await expect(waveform.locator('[data-slot="model-activity-waveform-track"]')).toBeVisible()
  await expect(status.locator(".status-text-compact")).toBeHidden()
  await expect(telemetry.locator(".streaming-token-usage")).toContainText("7.1M")
  await expect(telemetry.locator(".streaming-cost")).toBeHidden()
  await expect(shellTool.locator('[data-slot="bash-command"]')).toContainText("deliberately long mobile command")
  await expect(shellTool.locator('[data-slot="bash-copy"]')).toBeVisible()

  const layout = await page.evaluate(() => {
    const status = document.querySelector<HTMLElement>('[data-component="streaming-status-bar"]')
    const telemetry = status?.querySelector<HTMLElement>(".streaming-status-telemetry")
    const statusRect = status?.getBoundingClientRect()
    const telemetryRect = telemetry?.getBoundingClientRect()
    return {
      viewport: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      statusRight: statusRect?.right ?? 0,
      telemetryRight: telemetryRect?.right ?? 0,
    }
  })
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport)
  expect(layout.statusRight).toBeLessThanOrEqual(layout.viewport)
  expect(layout.telemetryRight).toBeLessThanOrEqual(layout.viewport)
  expect(consoleErrors).toEqual([])

  await testInfo.attach("mobile-streaming-ui", {
    body: await page.screenshot({ animations: "disabled" }),
    contentType: "image/png",
  })
})
