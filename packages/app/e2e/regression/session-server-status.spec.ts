import { expect, test } from "@playwright/test"
import { setupTimeline } from "../performance/timeline-stability/fixture"

test("Server Status setting immediately controls the active session server indicator", async ({ page }) => {
  await setupTimeline(page, { settings: { newLayoutDesigns: true, showStatus: false } })

  await expect(page.locator('button[aria-label="Connected"]')).toHaveCount(0)

  await page.keyboard.press("Control+,")
  const settings = page.locator(".settings-v2-dialog")
  if ((await settings.count()) === 0) await page.keyboard.press("Meta+,")
  await expect(settings).toBeVisible()
  const statusSetting = settings.locator('[data-action="settings-show-status"]')
  await statusSetting.locator('[data-slot="switch-control"]').click()
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("settings.v3") ?? "{}").general?.showStatus)).toBe(true)
  await page.keyboard.press("Escape")
  await expect(settings).toHaveCount(0)

  await expect(page.locator('button[aria-label="Connected"]')).toBeVisible()
})
