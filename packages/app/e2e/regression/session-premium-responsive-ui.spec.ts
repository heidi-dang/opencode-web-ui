import { expect, test } from "@playwright/test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { mockOpenCodeServer } from "../utils/mock-server"
import { expectSessionTitle } from "../utils/waits"

const directory = "C:/OpenCode/PremiumWorkspace"
const projectID = "proj_premium_workspace"
const sessionID = "ses_premium_workspace"
const title = "Premium Workspace Redesign"
const server = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`

const viewports = [
  { name: "iPhone SE (375x667)", width: 375, height: 667 },
  { name: "iPhone 14 Pro (390x844)", width: 390, height: 844 },
  { name: "iPhone 15 Pro Max (430x932)", width: 430, height: 932 },
  { name: "iPad Portrait (768x1024)", width: 768, height: 1024 },
  { name: "iPad Landscape (1024x768)", width: 1024, height: 768 },
  { name: "Laptop (1280x800)", width: 1280, height: 800 },
  { name: "Desktop (1440x900)", width: 1440, height: 900 },
  { name: "FHD (1920x1080)", width: 1920, height: 1080 },
]

test.beforeEach(async ({ page }) => {
  await mockOpenCodeServer(page, {
    protocol: "v1",
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "premium-workspace",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opencode",
          name: "OpenCode",
          models: { test: { id: "test", name: "Test", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opencode"],
      default: { providerID: "opencode", modelID: "test" },
    },
    sessions: [
      {
        id: sessionID,
        slug: sessionID,
        projectID,
        directory,
        title,
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({
      items: [
        {
          info: {
            id: "msg_user_1",
            sessionID,
            role: "user",
            time: { created: 1700000000000 },
            parentID: "",
          },
          parts: [
            {
              id: "prt_user_1",
              messageID: "msg_user_1",
              sessionID,
              type: "text",
              text: "Hi, can you review the new workspace layout?",
            },
          ],
        },
        {
          info: {
            id: "msg_assistant_1",
            sessionID,
            role: "assistant",
            time: { created: 1700000001000 },
            parentID: "msg_user_1",
          },
          parts: [
            {
              id: "prt_assistant_1",
              messageID: "msg_assistant_1",
              sessionID,
              type: "text",
              text: "Welcome to OpenCode! The unified Midnight Graphite workspace is active. Let me know what you would like to build.",
            },
          ],
        },
      ],
    }),
  })

  await page.addInitScript(
    ({ directory, server, sessionID }) => {
      localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
      localStorage.setItem("opencode-color-scheme", "dark")
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: { local: [{ worktree: directory, expanded: true }] },
          lastProject: { local: directory },
        }),
      )
      localStorage.setItem(
        "opencode.window.browser.dat:tabs",
        JSON.stringify([{ type: "session", server, sessionId: sessionID }]),
      )
    },
    { directory, server, sessionID },
  )
})

test.describe("Premium Responsive Workspace Acceptance", () => {
  for (const vp of viewports) {
    test(`renders without horizontal overflow and with clean hierarchy on ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
      await expectSessionTitle(page, title)

      // 1. Verify no horizontal document scroll/overflow
      const hasHorizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
      expect(hasHorizontalScroll).toBe(false)

      // 2. Composer is visible, compact, and has correct role
      const composer = page.locator('[data-component="prompt-input"]')
      await expect(composer).toBeVisible()
      const composerBox = await composer.boundingBox()
      expect(composerBox).not.toBeNull()
      expect(composerBox!.height).toBeLessThanOrEqual(56)

      // 3. User message and Assistant response are rendered with proper hierarchy
      const userMessage = page.locator('[data-component="user-message"]')
      await expect(userMessage).toBeVisible()
      const assistantMessage = page.locator('[data-slot="session-turn-assistant-content"]')
      await expect(assistantMessage).toBeVisible()

      // 4. On mobile (<768px), verify compact mobileTabs segmented control
      if (vp.width < 768) {
        const mobileTabs = page.locator('[data-component="mobile-session-tabs"]')
        await expect(mobileTabs).toBeVisible()
        const tabsBox = await mobileTabs.boundingBox()
        expect(tabsBox).not.toBeNull()
        expect(tabsBox!.height).toBeLessThanOrEqual(48)
      }

      // 5. Verify no isolated detached floating workspace toggle row
      const isolatedToggleRow = page.locator('div.flex.shrink-0.justify-end.px-3')
      await expect(isolatedToggleRow).toHaveCount(0)

      // 6. Screenshot capture for visual verification
      await page.screenshot({
        path: `/tmp/screenshot-${vp.width}x${vp.height}.png`,
        fullPage: false,
      })
    })
  }

  test("composer expands smoothly on multiline typing and shrinks on clear", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const composer = page.locator('[data-component="prompt-input"]')
    await expect(composer).toBeVisible()

    const initialHeight = (await composer.boundingBox())!.height

    // Focus and type text
    await composer.focus()
    await page.keyboard.type("Line 1")
    await page.keyboard.press("Shift+Enter")
    await page.keyboard.type("Line 2")
    await page.keyboard.press("Shift+Enter")
    await page.keyboard.type("Line 3")

    await expect.poll(async () => (await composer.boundingBox())?.height ?? 0).toBeGreaterThan(initialHeight)

    // Clear
    await page.keyboard.press("Control+A")
    await page.keyboard.press("Backspace")
    await expect.poll(async () => (await composer.boundingBox())?.height ?? 999).toBeLessThanOrEqual(initialHeight + 4)
  })

  test("switches between Session and Changes on mobile without layout shift", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/server/${base64Encode(server)}/session/${sessionID}`)
    await expectSessionTitle(page, title)

    const mobileTabs = page.locator('[data-component="mobile-session-tabs"]')
    await expect(mobileTabs).toBeVisible()

    const sessionTab = mobileTabs.getByRole("tab", { name: "Session" })
    const changesTab = mobileTabs.getByRole("tab", { name: /Changes/ })

    await expect(sessionTab).toHaveAttribute("aria-selected", "true")
    await changesTab.click()
    await expect(changesTab).toHaveAttribute("aria-selected", "true")
    await sessionTab.click()
    await expect(sessionTab).toHaveAttribute("aria-selected", "true")
  })
})
