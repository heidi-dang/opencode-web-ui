import { expect, test } from "@playwright/test"

const server = "http://127.0.0.1:4096"

test("server fleet shows health state and search controls", async ({ page }) => {
  await page.addInitScript(({ server }) => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    localStorage.setItem("opencode.global.dat:server", JSON.stringify({ list: [server] }))
  }, { server })

  await page.route(`${server}/**`, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === "/api/health") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ healthy: true, version: "1.18.18" }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) })
  })

  await page.goto("/")
  await page.keyboard.press("Control+,")

  const dialog = page.getByRole("dialog").filter({ hasText: "Servers" }).first()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole("textbox", { name: /search servers/i })).toBeVisible()
  await expect(dialog.getByText(/127\.0\.0\.1:4096/).first()).toBeVisible()
  await expect(dialog.locator("[class*='success']").first()).toBeVisible()

  await dialog.getByRole("textbox", { name: /search servers/i }).fill("missing")
  await expect(dialog.getByText(/missing/).first()).toBeVisible()
})
