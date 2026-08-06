import { expect, test } from "@playwright/test"
import {
  assistantMessage,
  partDelta,
  session,
  sessionUpdated,
  setupTimeline,
  textPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

const streamingMessages = () => [
  userMessage(),
  assistantMessage([textPart("prt_assistant_text", "")], { completed: false }),
]

test("carries live activity from the working phrase into telemetry", async ({ page }) => {
  const errors: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(error.message))

  const timeline = await setupTimeline(page, {
    settings: { newLayoutDesigns: true },
    sessions: [session({ tokens: undefined, cost: 0 })],
    messages: streamingMessages(),
  })
  const status = page.locator('[data-component="streaming-status-bar"]')
  const phrase = status.locator(".status-text-verbose")
  const waveform = status.locator('[data-component="model-activity-waveform"]')
  const track = waveform.locator('[data-slot="model-activity-waveform-track"]')
  const stateText = waveform.locator('[data-slot="model-activity-waveform-status"]')
  const initialHeight = await status.evaluate((element) => element.getBoundingClientRect().height)

  await expect(page.getByRole("status")).toHaveCount(1)
  await expect(phrase).toBeVisible()
  await expect(waveform).toBeVisible()
  await expect(track).toBeVisible()
  await expect(stateText).not.toContainText("since last activity")
  await expect(waveform.locator(".streaming-status-telemetry")).toHaveCount(0)
  await expect(waveform.locator(".heartbeat-indicator")).toHaveCount(0)
  await expect(waveform).toHaveAttribute("data-state", /active-/)

  const runner = waveform.locator('[data-slot="model-activity-waveform-runner"]')
  const runnerHandle = await runner.elementHandle()
  const initialEnergy = await waveform.evaluate((element) => ({
    amplitude: Number.parseFloat(element.style.getPropertyValue("--wave-amplitude")),
    glow: Number.parseFloat(element.style.getPropertyValue("--wave-glow")),
    duration: element.style.getPropertyValue("--wave-duration"),
    recent: Number.parseFloat(element.style.getPropertyValue("--wave-recent-boost")),
  }))
  expect(initialEnergy.recent).toBe(0)
  const initialRunnerStartTime = await runner.evaluate(
    (element) => element.getAnimations()[0]?.startTime ?? null,
  )
  expect(initialRunnerStartTime).not.toBeNull()

  await timeline.send(partDelta("prt_assistant_text", "activity"))
  await expect(waveform).toHaveAttribute("data-state", /active-/)
  await expect(stateText).toHaveText(/Thinking rapidly|Processing/)
  await expect
    .poll(() =>
      waveform.evaluate((element) => Number.parseFloat(element.style.getPropertyValue("--wave-recent-boost"))),
    )
    .toBeGreaterThan(0)
  const boostedEnergy = await waveform.evaluate((element) => ({
    amplitude: Number.parseFloat(element.style.getPropertyValue("--wave-amplitude")),
    glow: Number.parseFloat(element.style.getPropertyValue("--wave-glow")),
    duration: element.style.getPropertyValue("--wave-duration"),
  }))
  expect(boostedEnergy.amplitude).toBeGreaterThan(initialEnergy.amplitude)
  expect(boostedEnergy.glow).toBeGreaterThan(initialEnergy.glow)
  expect(boostedEnergy.duration).toBe(initialEnergy.duration)
  expect(await runnerHandle?.evaluate((element) => element.isConnected)).toBe(true)
  expect(await runner.evaluate((element) => element.getAnimations()[0]?.startTime ?? null)).toBe(
    initialRunnerStartTime,
  )
  await expect
    .poll(
      () =>
        waveform.evaluate((element) => Number.parseFloat(element.style.getPropertyValue("--wave-recent-boost"))),
      { timeout: 3_000 },
    )
    .toBe(0)
  await timeline.send(
    sessionUpdated(
      session({ tokens: { input: 1_200, output: 300, reasoning: 0, cache: { read: 0, write: 0 } } }),
    ),
  )

  const telemetry = waveform.locator(".streaming-status-telemetry")
  await expect(telemetry).toBeVisible()
  await expect(telemetry.locator(".streaming-token-usage")).toContainText("1,500")
  const geometry = await status.evaluate((element) => {
    const phrase = element.querySelector<HTMLElement>(".status-text-verbose")!
    const track = element.querySelector<HTMLElement>('[data-slot="model-activity-waveform-track"]')!
    const telemetry = element.querySelector<HTMLElement>(".streaming-status-telemetry")!
    return {
      phraseRight: phrase.getBoundingClientRect().right,
      trackLeft: track.getBoundingClientRect().left,
      trackRight: track.getBoundingClientRect().right,
      telemetryLeft: telemetry.getBoundingClientRect().left,
      height: element.getBoundingClientRect().height,
      viewport: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    }
  })
  expect(geometry.phraseRight).toBeLessThanOrEqual(geometry.trackLeft)
  expect(geometry.trackRight).toBeLessThanOrEqual(geometry.telemetryLeft)
  expect(Math.abs(geometry.height - initialHeight)).toBeLessThanOrEqual(1)
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewport)
  expect(errors).toEqual([])
})

test("gives the waveform the mobile status-label space", async ({ page }) => {
  await setupTimeline(page, {
    viewport: { width: 390, height: 844 },
    settings: { newLayoutDesigns: true },
    sessions: [
      session({
        cost: 1.2345,
        tokens: { input: 7_000_000, output: 100_000, reasoning: 951, cache: { read: 0, write: 0 } },
      }),
    ],
    messages: streamingMessages(),
  })
  const status = page.locator('[data-component="streaming-status-bar"]')
  const waveform = status.locator('[data-component="model-activity-waveform"]')
  const telemetry = status.locator(".streaming-status-telemetry")
  await expect(status.locator(".status-text-verbose")).toBeHidden()
  await expect(status.locator(".status-text-compact")).toBeHidden()
  await expect(waveform).toBeVisible()
  await expect(waveform.locator(".streaming-token-usage")).toContainText("7.1M")
  await expect(waveform.locator(".streaming-cost")).toBeHidden()
  const layout = await page.evaluate(() => {
    const status = document.querySelector<HTMLElement>('[data-component="streaming-status-bar"]')
    const telemetry = status?.querySelector<HTMLElement>(".streaming-status-telemetry")
    return {
      viewport: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      statusRight: status?.getBoundingClientRect().right ?? 0,
      telemetryRight: telemetry?.getBoundingClientRect().right ?? 0,
    }
  })
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport)
  expect(layout.statusRight).toBeLessThanOrEqual(layout.viewport)
  expect(layout.telemetryRight).toBeLessThanOrEqual(layout.viewport)
})

test("renders a static state-colored signal for reduced motion", async ({ page }) => {
  await setupTimeline(page, {
    reducedMotion: true,
    settings: { newLayoutDesigns: true },
    sessions: [
      session({ tokens: { input: 1_200, output: 300, reasoning: 0, cache: { read: 0, write: 0 } } }),
    ],
    messages: streamingMessages(),
  })
  const waveform = page.locator('[data-component="model-activity-waveform"]')
  await expect(waveform).toHaveAttribute("data-motion", "static")
  await expect(waveform).toHaveAttribute("data-tone", "accent")
  const animations = await waveform.evaluate((element) => ({
    runner: getComputedStyle(
      element.querySelector<HTMLElement>('[data-slot="model-activity-waveform-runner"]')!,
    ).animationName,
    arrival: getComputedStyle(
      element.querySelector<HTMLElement>('[data-slot="model-activity-waveform-arrival-glow"]')!,
    ).animationName,
  }))
  expect(animations).toEqual({ runner: "none", arrival: "none" })
})
