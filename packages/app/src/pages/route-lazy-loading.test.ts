import { describe, expect, test } from "bun:test"

/**
 * Tests for route-level lazy loading in app.tsx.
 *
 * These verify that all major route components are loaded via dynamic
 * import (lazy()), keeping the entry chunk small. Route-level splits:
 *
 * - DirectoryLayout  → @/pages/directory-layout
 * - LegacyLayout     → @/pages/layout
 * - NewLayout        → @/pages/layout-new
 * - SessionPage      → @/pages/session
 * - TargetSessionRouteContent → @/pages/session
 * - NewHome          → @/pages/home
 * - LegacyHome       → @/pages/home/legacy-home
 * - NewSession       → @/pages/new-session
 */

describe("route lazy loading", () => {
  test("app.tsx defines file-level route lazy imports", async () => {
    const appSource = await Bun.file(import.meta.dirname + "/../app.tsx").text()
    const lazyDeclarations = appSource.match(/const \w+ = lazy\(\(\) => import\([^)]+\)/g)
    expect(lazyDeclarations).not.toBeNull()

    const lazyPaths = lazyDeclarations!.map((d) => {
      const match = d.match(/import\("([^"]+)"\)/)
      return match ? match[1] : null
    }).filter(Boolean)

    // Core route boundaries that must be lazy
    const expectedPaths = [
      "@/pages/directory-layout",
      "@/pages/layout",
      "@/pages/layout-new",
      "@/pages/session",
      "@/pages/home",
    ]

    for (const path of expectedPaths) {
      expect(lazyPaths).toContain(path)
    }
  })

  test("all lazy import paths in app.tsx resolve to actual files", async () => {
    // Verify lazy import paths in app.tsx resolve to actual files.
    // The @/ alias maps to src/.
    const appSource = await Bun.file(import.meta.dirname + "/../app.tsx").text()
    const lazyPaths = [...appSource.matchAll(/import\("([^"]+)"\)/g)].map((m) => m[1])

    for (const path of lazyPaths) {
      // Convert @/pages/directory-layout → src/pages/directory-layout.tsx
      const relative = path.replace("@/", "")
      // Check possible extensions: .tsx, .ts
      const root = import.meta.dirname + "/.." // src/
      const tsxPath = `${root}/${relative}.tsx`
      const tsPath = `${root}/${relative}.ts`
      const exists =
        require("fs").existsSync(tsxPath) || require("fs").existsSync(tsPath)
      expect(exists).toBe(true)
    }
  })
})

describe("internal lazy loading (session.tsx)", () => {
  test("session.tsx has internal lazy imports for heavy sub-components", async () => {
    const sessionSource = await Bun.file(import.meta.dirname + "/session.tsx").text()
    const lazyDeclarations = sessionSource.match(/const \w+ = lazy\(\(\) => import\([^)]+\)/g)
    expect(lazyDeclarations).not.toBeNull()

    const lazyPaths = lazyDeclarations!.map((d) => {
      const match = d.match(/import\("([^"]+)"\)/)
      return match ? match[1] : null
    }).filter(Boolean)

    // Heavy sub-components that must be lazy within session.tsx
    const expectedPaths = [
      "review-tab",
      "terminal-panel",
    ]

    for (const path of expectedPaths) {
      expect(lazyPaths.some((p) => p?.includes(path))).toBe(true)
    }
  })
})

describe("guide lazy loading (marked.tsx)", () => {
  test("shiki is lazy-loaded on first highlight", async () => {
    const markedSource = await Bun.file(
      import.meta.dirname + "/../../../ui/src/context/marked.tsx",
    ).text()

    // shiki bundledLanguages are loaded lazily
    expect(markedSource).toContain('import("shiki")')
    expect(markedSource).toContain("bundledLanguagesPromise")
  })

  test("katex is lazy-loaded on first math expression", async () => {
    const markedSource = await Bun.file(
      import.meta.dirname + "/../../../ui/src/context/marked.tsx",
    ).text()

    expect(markedSource).toContain('import("katex")')
    expect(markedSource).toContain("katexModulePromise")
  })

  test("@pierre/diffs is lazy-loaded on first highlight", async () => {
    const markedSource = await Bun.file(
      import.meta.dirname + "/../../../ui/src/context/marked.tsx",
    ).text()

    expect(markedSource).toContain('import("@pierre/diffs")')
    expect(markedSource).toContain("pierreModulePromise")
  })
})

describe("Ghostty lazy loading", () => {
  test("ghostty-web is lazy-loaded on first terminal creation", async () => {
    const terminalSource = await Bun.file(
      import.meta.dirname + "/../../components/terminal.tsx",
    ).text()

    // Ghostty library is loaded lazily via loadGhostty()
    expect(terminalSource).toContain('import("ghostty-web")')
    expect(terminalSource).toContain("loadGhostty")
  })
})

describe("DirectoryDataProvider standalone file", () => {
  test("directory-data-provider.tsx exists and exports DirectoryDataProvider", async () => {
    const mod = await import("./directory-data-provider")
    expect(mod.DirectoryDataProvider).toBeDefined()
    expect(typeof mod.DirectoryDataProvider).toBe("function")
  })

  test("app.tsx imports DirectoryDataProvider from the standalone file", async () => {
    const appSource = await Bun.file(import.meta.dirname + "/../app.tsx").text()
    expect(appSource).toContain('import { DirectoryDataProvider } from "@/pages/directory-data-provider"')
  })
})
