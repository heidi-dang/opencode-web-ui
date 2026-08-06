import { expect, test, type Locator, type Page } from "@playwright/test"
import {
  assistantMessage,
  partDelta,
  session,
  sessionUpdated,
  setupTimeline,
  textPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number }
type Layout = {
  status: Rect
  phrase: Rect | null
  track: Rect
  telemetry: Rect | null
  timer: Rect | null
  viewportWidth: number
  documentWidth: number
}

const messages = () => [
  userMessage(),
  assistantMessage([textPart("prt_assistant_text", "")], { completed: false }),
]

const telemetrySession = () =>
  session({
    cost: 1.2345,
    tokens: { input: 7_000_000, output: 100_000, reasoning: 951, cache: { read: 0, write: 0 } },
  })

function captureProblems(page: Page) {
  const problems: string[] = []
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      if (message.type() === "warning" && /^\[command\] duplicate command id .+ keeping first entry$/.test(message.text())) {
        return
      }
      problems.push(`${message.type()}: ${message.text()}`)
    }
  })
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`))
  return problems
}

async function setColorScheme(page: Page, scheme: "light" | "dark") {
  await page.addInitScript((value) => localStorage.setItem("opencode-color-scheme", value), scheme)
}

async function capture(page: Page, path: string) {
  if (process.env.MODEL_WAVEFORM_CAPTURE !== "1") return
  await page.screenshot({ path, animations: "allow" })
}

async function readLayout(status: Locator): Promise<Layout> {
  return status.evaluate((element) => {
    const rect = (target: Element | null): Rect | null => {
      if (!(target instanceof HTMLElement)) return null
      const style = getComputedStyle(target)
      const bounds = target.getBoundingClientRect()
      if (style.display === "none" || style.visibility === "hidden" || bounds.width <= 0 || bounds.height <= 0) return null
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
        height: bounds.height,
      }
    }
    const statusBounds = element.getBoundingClientRect()
    const track = rect(element.querySelector('[data-slot="model-activity-waveform-track"]'))
    if (!track) throw new Error("visible waveform track is missing")
    return {
      status: {
        left: statusBounds.left,
        right: statusBounds.right,
        top: statusBounds.top,
        bottom: statusBounds.bottom,
        width: statusBounds.width,
        height: statusBounds.height,
      },
      phrase: rect(element.querySelector(".status-text-verbose")),
      track,
      telemetry: rect(element.querySelector(".streaming-status-telemetry")),
      timer: rect(element.querySelector(".elapsed-timer")),
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
    }
  })
}

function expectContained(parent: Rect, child: Rect) {
  expect(child.left).toBeGreaterThanOrEqual(parent.left - 0.5)
  expect(child.right).toBeLessThanOrEqual(parent.right + 0.5)
  expect(child.top).toBeGreaterThanOrEqual(parent.top - 0.5)
  expect(child.bottom).toBeLessThanOrEqual(parent.bottom + 0.5)
}

function expectLayout(layout: Layout, width: number, input: { telemetry: boolean; timer: boolean }) {
  expect(layout.viewportWidth).toBe(width)
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)
  expect(layout.track.width).toBeGreaterThanOrEqual(24)
  expectContained(layout.status, layout.track)

  if (width <= 640) expect(layout.phrase).toBeNull()
  if (width > 640) {
    expect(layout.phrase).not.toBeNull()
    expectContained(layout.status, layout.phrase!)
    expect(layout.phrase!.right).toBeLessThanOrEqual(layout.track.left + 0.5)
  }

  if (input.telemetry) {
    expect(layout.telemetry).not.toBeNull()
    expectContained(layout.status, layout.telemetry!)
    expect(layout.track.right).toBeLessThanOrEqual(layout.telemetry!.left + 0.5)
  } else {
    expect(layout.telemetry).toBeNull()
  }

  if (input.timer) {
    expect(layout.timer).not.toBeNull()
    expectContained(layout.status, layout.timer!)
    const preceding = layout.telemetry ?? layout.track
    expect(preceding.right).toBeLessThanOrEqual(layout.timer!.left + 0.5)
  } else {
    expect(layout.timer).toBeNull()
  }
}

const responsiveCases = [
  { width: 390, height: 844, scheme: "dark" as const },
  { width: 640, height: 900, scheme: "light" as const },
  { width: 641, height: 900, scheme: "dark" as const },
  { width: 1_400, height: 900, scheme: "dark" as const },
]

for (const scenario of responsiveCases) {
  test(`keeps waveform geometry stable at ${scenario.width}px`, async ({ page }) => {
    const problems = captureProblems(page)
    await setColorScheme(page, scenario.scheme)
    const timeline = await setupTimeline(page, {
      viewport: { width: scenario.width, height: scenario.height },
      settings: { newLayoutDesigns: true },
      sessions: [session({ tokens: undefined, cost: 0 })],
      messages: messages(),
    })

    const status = page.locator('[data-component="streaming-status-bar"]')
    const waveform = status.locator('[data-component="model-activity-waveform"]')
    const timer = status.locator(".elapsed-timer")
    await expect(page).toHaveTitle("Heidi")
    await expect(page.locator("vite-error-overlay")).toHaveCount(0)
    await expect(page.locator("h1", { hasText: "Timeline visual stability" })).toBeVisible()
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", scenario.scheme)
    await expect(waveform).toHaveAttribute("data-has-telemetry", "false")
    const initial = await readLayout(status)
    expectLayout(initial, scenario.width, { telemetry: false, timer: false })

    await expect(timer).toBeVisible()
    const withTimer = await readLayout(status)
    expectLayout(withTimer, scenario.width, { telemetry: false, timer: true })
    expect(Math.abs(withTimer.status.height - initial.status.height)).toBeLessThanOrEqual(1)

    const runner = waveform.locator('[data-slot="model-activity-waveform-runner"]')
    const telemetrySlot = waveform.locator('[data-slot="model-activity-waveform-telemetry"]')
    const arrivalGlow = waveform.locator('[data-slot="model-activity-waveform-arrival-glow"]')
    const runnerHandle = await runner.elementHandle()
    const telemetrySlotHandle = await telemetrySlot.elementHandle()
    const arrivalGlowHandle = await arrivalGlow.elementHandle()
    const initialClocks = await waveform.evaluate((element) => ({
      runner: element.querySelector<HTMLElement>('[data-slot="model-activity-waveform-runner"]')!.getAnimations()[0]
        ?.startTime,
      arrival: element
        .querySelector<HTMLElement>('[data-slot="model-activity-waveform-arrival-glow"]')!
        .getAnimations()[0]?.startTime,
    }))
    expect(initialClocks.runner).toEqual(expect.any(Number))
    expect(initialClocks.arrival).toEqual(expect.any(Number))

    if (scenario.width === 1_400) {
      const animatedProperties = await waveform.evaluate((element) => {
        const metadata = new Set(["offset", "computedOffset", "easing", "composite"])
        return [
          ...new Set(
            element
              .getAnimations({ subtree: true })
              .flatMap((animation) =>
                animation.effect instanceof KeyframeEffect
                  ? animation.effect.getKeyframes().flatMap((frame) => Object.keys(frame))
                  : ["non-keyframe-effect"],
              )
              .filter((property) => !metadata.has(property)),
          ),
        ].sort()
      })
      expect(animatedProperties).toEqual(["opacity", "transform"])
      await capture(page, "/tmp/model-waveform-desktop-before.png")
      await capture(page, "/tmp/model-waveform-desktop-dark-before-telemetry.png")
      await timeline.send(partDelta("prt_assistant_text", "activity"))
      await expect
        .poll(() =>
          waveform.evaluate((element) => Number.parseFloat(element.style.getPropertyValue("--wave-recent-boost"))),
        )
        .toBeGreaterThan(0)
    }

    await timeline.send(sessionUpdated(telemetrySession()))
    await expect(waveform).toHaveAttribute("data-has-telemetry", "true")
    const telemetry = waveform.locator(".streaming-status-telemetry")
    await expect(telemetry).toBeVisible()
    await expect(telemetry.locator(".streaming-token-usage")).toContainText(
      scenario.width <= 640 ? "7.1M" : "7,100,951",
    )
    if (scenario.width <= 640) await expect(telemetry.locator(".streaming-cost")).toBeHidden()
    if (scenario.width > 640) await expect(telemetry.locator(".streaming-cost")).toBeVisible()

    const complete = await readLayout(status)
    expectLayout(complete, scenario.width, { telemetry: true, timer: true })
    expect(Math.abs(complete.status.height - initial.status.height)).toBeLessThanOrEqual(1)
    expect(await runnerHandle?.evaluate((element) => element.isConnected)).toBe(true)
    expect(await telemetrySlotHandle?.evaluate((element) => element.isConnected)).toBe(true)
    expect(await arrivalGlowHandle?.evaluate((element) => element.isConnected)).toBe(true)
    expect(
      await waveform.evaluate((element) => ({
        runner: element.querySelector<HTMLElement>('[data-slot="model-activity-waveform-runner"]')!.getAnimations()[0]
          ?.startTime,
        arrival: element
          .querySelector<HTMLElement>('[data-slot="model-activity-waveform-arrival-glow"]')!
          .getAnimations()[0]?.startTime,
      })),
    ).toEqual(initialClocks)

    if (scenario.width === 390) {
      await capture(page, "/tmp/model-waveform-mobile.png")
      await capture(page, "/tmp/model-waveform-mobile-dark.png")
    }
    if (scenario.width === 640) await capture(page, "/tmp/model-waveform-640-light.png")
    if (scenario.width === 641) await capture(page, "/tmp/model-waveform-641-dark.png")
    if (scenario.width === 1_400) {
      await capture(page, "/tmp/model-waveform-desktop.png")
      await capture(page, "/tmp/model-waveform-desktop-dark.png")
    }
    expect(problems).toEqual([])
  })
}

test("keeps the ECG packet bounded on a wide light track", async ({ page }) => {
  const problems = captureProblems(page)
  await setColorScheme(page, "light")
  await setupTimeline(page, {
    viewport: { width: 1_920, height: 1_080 },
    settings: { newLayoutDesigns: true },
    sessions: [telemetrySession()],
    messages: messages(),
  })
  const waveform = page.locator('[data-component="model-activity-waveform"]')
  const packet = waveform.locator('[data-slot="model-activity-waveform-runner"] svg')
  await expect(packet).toHaveAttribute("preserveAspectRatio", "xMidYMid meet")
  const packetBox = await packet.boundingBox()
  expect(packetBox).not.toBeNull()
  expect(packetBox!.width).toBeGreaterThanOrEqual(48)
  expect(packetBox!.width).toBeLessThanOrEqual(76)
  await capture(page, "/tmp/model-waveform-wide-light.png")
  expect(problems).toEqual([])
})

test("captures a centered static packet with reduced motion", async ({ page }) => {
  const problems = captureProblems(page)
  await setColorScheme(page, "dark")
  await setupTimeline(page, {
    viewport: { width: 1_400, height: 900 },
    reducedMotion: true,
    settings: { newLayoutDesigns: true },
    sessions: [telemetrySession()],
    messages: messages(),
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
    subtree: element.getAnimations({ subtree: true }).length,
  }))
  expect(animations).toEqual({ runner: "none", arrival: "none", subtree: 0 })
  await capture(page, "/tmp/model-waveform-reduced-motion.png")
  expect(problems).toEqual([])
})
