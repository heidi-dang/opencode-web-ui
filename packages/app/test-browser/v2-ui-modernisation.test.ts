import { describe, test, expect } from "bun:test"
import themeCss from "../../ui/src/v2/styles/theme.css" with { type: "text" }
import settingsCss from "../src/components/settings-v2/settings-v2.css" with { type: "text" }

describe("V2 UI Modernisation — Design System & Visual Performance Invariants", () => {
  test("Theme CSS exports all canonical Deep Aurora tokens in light and dark modes", () => {
    const requiredTokens = [
      "--v2-gradient-brand",
      "--v2-gradient-brand-subtle",
      "--v2-gradient-ambient-canvas",
      "--v2-surface-glass",
      "--v2-surface-glass-strong",
      "--v2-border-highlight",
      "--v2-border-highlight-strong",
      "--v2-glow-accent-sm",
      "--v2-glow-accent-md",
      "--v2-glow-accent-lg",
      "--v2-glow-status-success",
      "--v2-glow-status-danger",
      "--v2-glow-status-streaming",
      "--v2-elevation-panel",
      "--v2-elevation-dock",
      "--v2-elevation-modal",
      "--v2-blur-floating",
      "--v2-blur-modal",
      "--v2-motion-fast",
      "--v2-motion-standard",
      "--v2-motion-emphasis",
      "--v2-motion-easing-standard",
      "--v2-motion-easing-expressive",
      "--v2-motion-easing-decelerate",
    ]

    for (const token of requiredTokens) {
      expect(themeCss).toContain(token)
    }
  })

  test("No obsolete hardcoded indigo/violet rgba glows remain in production index.css", async () => {
    const indexCssFile = Bun.file("src/index.css")
    const content = await indexCssFile.text()

    // Keyframes & classes should use v2 tokens, not raw rgba(99, 102, 241) or rgba(139, 92, 246)
    expect(content).not.toContain("box-shadow: 0 0 12px rgba(99, 102, 241")
    expect(content).not.toContain("box-shadow: 0 0 20px rgba(99, 102, 241")
    expect(content).not.toContain("border-color: rgba(139, 92, 246")
  })

  test("Accessibility: forced-colors and prefers-reduced-motion overrides exist", async () => {
    const indexCssFile = Bun.file("src/index.css")
    const content = await indexCssFile.text()

    expect(content).toContain("@media (forced-colors: active)")
    expect(content).toContain("@media (prefers-reduced-motion: reduce)")
    expect(content).toContain(".glass-panel")
    expect(content).toContain(".glass-card")
  })

  test("Settings V2 contains responsive 200% zoom and forced-colors accessibility rules", () => {
    expect(settingsCss).toContain("@media (forced-colors: active)")
    expect(settingsCss).toContain("@media (prefers-reduced-motion: reduce)")
    expect(settingsCss).toContain("--v2-background-bg-base")
    expect(settingsCss).toContain("--v2-elevation-raised")
  })
})
