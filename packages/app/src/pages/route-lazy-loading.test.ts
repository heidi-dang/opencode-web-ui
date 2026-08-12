import { describe, expect, test } from "bun:test"

/**
 * Behavioral tests for route-level lazy loading in app.tsx.
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
 *
 * Each test verifies that:
 *  1. The import path is defined in app.tsx
 *  2. The target file exists on disk
 *  3. The module has the expected exports
 */

const SRC = import.meta.dirname + "/.."

function resolveModulePath(importPath: string): string | null {
  const relative = importPath.replace("@/", "")
  const tsxPath = `${SRC}/${relative}.tsx`
  const tsPath = `${SRC}/${relative}.ts`
  const indexPath = `${SRC}/${relative}/index.ts`
  const indexTsxPath = `${SRC}/${relative}/index.tsx`
  if (require("fs").existsSync(tsxPath)) return tsxPath
  if (require("fs").existsSync(tsPath)) return tsPath
  if (require("fs").existsSync(indexTsxPath)) return indexTsxPath
  if (require("fs").existsSync(indexPath)) return indexPath
  return null
}

async function lazyPathsFromSource(): Promise<string[]> {
  const appSource = await require("fs").promises.readFile(import.meta.dirname + "/../app.tsx", "utf-8")
  return [...appSource.matchAll(/(?:safeLazy|lazy)\(\(\) => import\("([^"]+)"\)/g)].map((m) => m[1])
}

/**
 * Expected lazy route entries and their component exports.
 *
 * Each entry maps the lazy import path → { modulePath, exports }
 * so we can verify the module resolves and exports the right symbols.
 */
const ROUTE_MODULES: Record<
  string,
  { defaultExport?: string; namedExports?: string[] }
> = {
  "@/pages/directory-layout": { defaultExport: "Layout" },
  "@/pages/layout": { defaultExport: "LegacyLayout" },
  "@/pages/layout-new": { defaultExport: "NewLayout" },
  "@/pages/session": { namedExports: ["SessionPage", "TargetSessionRouteContent"] },
  "@/pages/home": { namedExports: ["NewHome"] },
  "@/pages/home/legacy-home": { namedExports: ["LegacyHome"] },
  "@/pages/new-session": { defaultExport: "NewSessionPage" },
}

describe("route lazy loading", () => {
  test("all lazy import paths resolve to actual files on disk", async () => {
    const lazyPaths = await lazyPathsFromSource()
    expect(lazyPaths.length).toBeGreaterThanOrEqual(5)

    for (const path of lazyPaths) {
      const resolved = resolveModulePath(path)
      expect(resolved).not.toBeNull()
    }
  })

  test("every expected route module is referenced in the lazy declarations", async () => {
    const lazyPaths = await lazyPathsFromSource()
    for (const expectedPath of Object.keys(ROUTE_MODULES)) {
      expect(lazyPaths).toContain(expectedPath)
    }
  })

  test("core route boundaries are defined as lazy imports", async () => {
    const lazyPaths = await lazyPathsFromSource()

    const corePaths = [
      "@/pages/directory-layout",
      "@/pages/layout",
      "@/pages/layout-new",
      "@/pages/session",
      "@/pages/home",
    ]

    for (const path of corePaths) {
      expect(lazyPaths).toContain(path)
    }
  })

  test("each lazy route file exports its expected component symbol", async () => {
    const lazyPaths = await lazyPathsFromSource()

    // For each route module defined in our known list, verify the file exports
    // the expected component symbol. We read the source file directly to check
    // export declarations — this works for JSX and non-JSX modules alike.
    for (const [importPath, exports] of Object.entries(ROUTE_MODULES)) {
      expect(lazyPaths).toContain(importPath)
      const filePath = resolveModulePath(importPath)
      expect(filePath).not.toBeNull()

      const source = await require("fs").promises.readFile(filePath!, "utf-8")

      if (exports.defaultExport) {
        // Check for default export or export default function/const
        const hasDefaultExport =
          /export\s+default\s+/.test(source) ||
          source.includes(`export { default: ${exports.defaultExport}`) ||
          source.includes(`export default ${exports.defaultExport}`)
        expect(hasDefaultExport).toBe(true)
      }

      if (exports.namedExports) {
        for (const name of exports.namedExports) {
          const hasExport =
            new RegExp(`export\\s+(?:function|const|)\\s*${name}`).test(source) ||
            source.includes(`export { ${name}`) ||
            source.includes(`export { ${name},`) ||
            source.includes(`, ${name},`) ||
            source.includes(`, ${name} }`)
          expect(hasExport).toBe(true)
        }
      }
    }
  })
})

describe("internal lazy loading (session.tsx)", () => {
  test("session.tsx lazy-imports heavy sub-components with file resolution", async () => {
    const sessionSource = await require("fs").promises.readFile(
      import.meta.dirname + "/session.tsx",
      "utf-8",
    )
    const lazyDeclarations = sessionSource.match(
      /const \w+ = lazy\(\(\) => import\([^)]+\)/g,
    )
    expect(lazyDeclarations).not.toBeNull()

    const lazyPaths = lazyDeclarations!.map((d: string) => {
      const match = d.match(/import\("([^"]+)"\)/)
      return match ? match[1] : null
    }).filter(Boolean)

    // Heavy sub-components that must be lazy within session.tsx
    const expectedPaths = ["review-tab", "terminal-panel"]

    for (const path of expectedPaths) {
      expect(lazyPaths.some((p: string | null) => p?.includes(path))).toBe(true)
    }

    // Additionally, verify each lazy path resolves to an actual file.
    // Paths use the @/ alias which maps to src/.
    for (const lazyPath of lazyPaths) {
      const resolved = resolveModulePath(lazyPath)
      expect(resolved).not.toBeNull()
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
      import.meta.dirname + "/../components/terminal.tsx",
    ).text()

    // Ghostty library is loaded lazily via loadGhostty()
    expect(terminalSource).toContain('import("ghostty-web")')
    expect(terminalSource).toContain("loadGhostty")
  })
})

describe("DirectoryDataProvider standalone file", () => {
  test("app.tsx imports DirectoryDataProvider from the standalone file", async () => {
    const appSource = await Bun.file(import.meta.dirname + "/../app.tsx").text()
    expect(appSource).toContain(
      'import { DirectoryDataProvider } from "@/pages/directory-data-provider"',
    )
  })

  test("directory-data-provider file exists on disk", () => {
    const tsxPath = SRC + "/pages/directory-data-provider.tsx"
    expect(require("fs").existsSync(tsxPath)).toBe(true)
  })
})
