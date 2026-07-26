#!/usr/bin/env bun
/**
 * Phase 2A — Test Inventory
 *
 * Discovers every test file across all workspace packages, counts test cases,
 * checks CI inclusion, notes runtime dependencies, runs test files, and
 * produces a structured JSON report at scripts/audit/test-inventory-report.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs"
import { resolve, relative, dirname, basename } from "node:path"
import { spawnSync, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { fileURLToPath } from "node:url"

// ── Paths ────────────────────────────────────────────────────────────────────
const ROOT = resolve(import.meta.dirname, "../..")
const WORKSPACE_DIR = resolve(ROOT, "packages")
const REPORT_PATH = resolve(ROOT, "scripts/audit/test-inventory-report.json")
const CI_FILE = resolve(ROOT, ".github/workflows/ci.yml")

const ciContent = existsSync(CI_FILE) ? readFileSync(CI_FILE, "utf-8") : ""

// ── Types ────────────────────────────────────────────────────────────────────
type PackageInfo = {
  name: string
  path: string
  version?: string
  scripts?: Record<string, string>
}

type TestCaseBlock = {
  type: "describe" | "test" | "it"
  name: string
  line: number
}

type TestFile = {
  package: string
  path: string
  relativePath: string
  testCaseBlocks: TestCaseBlock[]
  testBlockCount: number
  testCount: number
  describeCount: number
  includedInCI: boolean
  runtimeDependencies: string[]
  execution: {
    passed: number
    failed: number
    skipped: number
    durationMs: number
    error?: string
    status: "passed" | "failed" | "skipped" | "error" | "not_run"
  }
}

type TestInventoryReport = {
  generatedAt: string
  summary: {
    totalPackages: number
    totalTestFiles: number
    totalTestBlocks: number
    totalTestCases: number
    totalDescribeBlocks: number
    totalPassed: number
    totalFailed: number
    totalSkipped: number
    totalDurationMs: number
    packagesWithTests: number
    packagesWithoutTests: number
    includedInCI: number
    excludedFromCI: number
  }
  ciConfig: {
    workspaceTestPattern: string
    packagesInCI: string[]
    packagesExcludedFromCI: string[]
    hasUnitJob: boolean
    hasBrowserJob: boolean
    hasE2EJob: boolean
    hasStabilityJob: boolean
    hasBenchmarkJob: boolean
    hasTestInventoryJob: boolean
  }
  issues: {
    serverSessionFailures: string[]
    ghosttyWeb: string
    desktopOnlyPaths: string[]
    excludedFromCI: string[]
  }
  packages: Record<string, {
    name: string
    path: string
    packageInfo: PackageInfo
    testFiles: TestFile[]
  }>
  errors: string[]
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively find test files in a directory */
function findTestFiles(dir: string, maxDepth = 6): string[] {
  const results: string[] = []
  function walk(current: string, depth: number) {
    if (depth > maxDepth) return
    try {
      const entries = readdirSync(current, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = resolve(current, entry.name)
        if (entry.isDirectory()) {
          if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue
          walk(fullPath, depth + 1)
        } else if (entry.isFile()) {
          if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
            results.push(fullPath)
          }
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }
  walk(dir, 0)
  return results
}

/** Count test blocks in a file */
function countTestBlocks(content: string): TestCaseBlock[] {
  const blocks: TestCaseBlock[] = []
  const lines = content.split("\n")
  // Also search for describe/it/test without accounting for line continuations
  const describeRe = /^\s*(?:export\s+)?describe\s*\(\s*["'`](.+?)["'`]/g
  const testRe = /^\s*(?:export\s+)?(?:test|it)\s*\(\s*["'`](.+?)["'`]/g

  let match: RegExpExecArray | null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    describeRe.lastIndex = 0
    testRe.lastIndex = 0
    if ((match = describeRe.exec(line))) {
      blocks.push({ type: "describe", name: match[1], line: i + 1 })
    }
    if ((match = testRe.exec(line))) {
      blocks.push({ type: "test", name: match[1], line: i + 1 })
    }
  }

  return blocks
}

/** Read package.json for a workspace package */
function readPackageJson(pkgDir: string): PackageInfo | null {
  const pkgPath = resolve(pkgDir, "package.json")
  if (!existsSync(pkgPath)) return null
  try {
    const content = JSON.parse(readFileSync(pkgPath, "utf-8"))
    return {
      name: content.name || basename(pkgDir),
      path: pkgDir,
      version: content.version,
      scripts: content.scripts,
    }
  } catch {
    return null
  }
}

/** Check if a path is referenced in CI */
function isIncludedInCI(relativePath: string, packageName: string): boolean {
  // Check CI yml content
  const patterns = [
    relativePath,
    packageName,
    basename(relativePath),
  ]
  return patterns.some((p) => ciContent.includes(p))
}

/** Get runtime dependencies from import statements */
function getRuntimeDependencies(content: string): string[] {
  const deps = new Set<string>()
  const importRe = /from\s+["']([^"']+)["']/g
  let match: RegExpExecArray | null
  while ((match = importRe.exec(content)) !== null) {
    const spec = match[1]
    if (spec.startsWith(".") || spec.startsWith("@/")) continue
    // Extract package name
    if (spec.startsWith("@")) {
      const parts = spec.split("/")
      deps.add(`${parts[0]}/${parts[1]}`)
    } else {
      const parts = spec.split("/")
      deps.add(parts[0])
    }
  }
  return [...deps].sort()
}

// ── Main ─────────────────────────────────────────────────────────────────────
const report: TestInventoryReport = {
  generatedAt: new Date().toISOString(),
  summary: {
    totalPackages: 0,
    totalTestFiles: 0,
    totalTestBlocks: 0,
    totalTestCases: 0,
    totalDescribeBlocks: 0,
    totalPassed: 0,
    totalFailed: 0,
    totalSkipped: 0,
    totalDurationMs: 0,
    packagesWithTests: 0,
    packagesWithoutTests: 0,
    includedInCI: 0,
    excludedFromCI: 0,
  },
  ciConfig: {
    workspaceTestPattern: "not explicitly configured (bun test per-package)",
    packagesInCI: [],
    packagesExcludedFromCI: [],
    hasUnitJob: ciContent.includes("Unit Tests"),
    hasBrowserJob: ciContent.includes("Browser Tests"),
    hasE2EJob: ciContent.includes("Official OpenCode Smoke"),
    hasStabilityJob: ciContent.includes("stability"),
    hasBenchmarkJob: ciContent.includes("bench"),
    hasTestInventoryJob: false,
  },
  issues: {
    serverSessionFailures: [],
    ghosttyWeb: "ghostty-web is an optional terminal emulator integration — not critical for test execution. Tests importing it directly may fail without it installed.",
    desktopOnlyPaths: [],
    excludedFromCI: [],
  },
  packages: {},
  errors: [],
}

// Find all workspace packages
const workspaceDirs = readdirSync(WORKSPACE_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => resolve(WORKSPACE_DIR, d.name))

report.summary.totalPackages = workspaceDirs.length

for (const pkgDir of workspaceDirs) {
  const pkgInfo = readPackageJson(pkgDir)
  if (!pkgInfo) {
    report.summary.packagesWithoutTests++
    continue
  }

  const testFiles = findTestFiles(pkgDir)
  const pkgName = pkgInfo.name

  if (testFiles.length === 0) {
    report.summary.packagesWithoutTests++
    continue
  }

  report.summary.packagesWithTests++
  const pkgData = { name: pkgName, path: pkgDir, packageInfo: pkgInfo, testFiles: [] as TestFile[] }

  for (const filePath of testFiles) {
    const relPath = relative(ROOT, filePath)
    const content = readFileSync(filePath, "utf-8")
    const blocks = countTestBlocks(content)
    const deps = getRuntimeDependencies(content)
    const inCI = isIncludedInCI(relPath, pkgName)

    // Check for ghostty-web imports
    if (content.includes("ghostty-web")) {
      report.issues.desktopOnlyPaths.push(relPath)
    }

    if (!inCI) {
      report.issues.excludedFromCI.push(relPath)
    }

    const testFile: TestFile = {
      package: pkgName,
      path: filePath,
      relativePath: relPath,
      testCaseBlocks: blocks,
      testBlockCount: blocks.length,
      testCount: blocks.filter((b) => b.type === "test" || b.type === "it").length,
      describeCount: blocks.filter((b) => b.type === "describe").length,
      includedInCI: inCI,
      runtimeDependencies: deps,
      execution: {
        passed: 0,
        failed: 0,
        skipped: 0,
        durationMs: 0,
        status: "not_run",
      },
    }

    report.summary.totalTestBlocks += testFile.testBlockCount
    report.summary.totalTestCases += testFile.testCount
    report.summary.totalDescribeBlocks += testFile.describeCount

    if (inCI) report.summary.includedInCI++
    else report.summary.excludedFromCI++

    pkgData.testFiles.push(testFile)
  }

  report.packages[pkgName] = pkgData
}

report.summary.totalTestFiles = Object.values(report.packages).reduce(
  (sum, pkg) => sum + pkg.testFiles.length, 0,
)

// Determine CI config
for (const [name] of Object.entries(report.packages)) {
  if (ciContent.includes(name)) {
    report.ciConfig.packagesInCI.push(name)
  } else {
    report.ciConfig.packagesExcludedFromCI.push(name)
  }
}

// --- Phase 2A issue investigation: server-session.test.ts ---
const serverSessionFile = Object.values(report.packages)
  .flatMap((pkg) => pkg.testFiles)
  .find((tf) => tf.relativePath.includes("server-session.test"))

if (serverSessionFile) {
  report.issues.serverSessionFailures.push(
    "server-session.test.ts found at " + serverSessionFile.relativePath,
    "File has " + serverSessionFile.testCount + " test cases and " + serverSessionFile.describeCount + " describe blocks",
    "Runtime deps: " + serverSessionFile.runtimeDependencies.join(", "),
  )
}

// Check ghostty-web resolution
const pkgJsonPath = resolve(ROOT, "packages/app/package.json")
if (existsSync(pkgJsonPath)) {
  const appPkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"))
  if (appPkg.dependencies?.["ghostty-web"]) {
    report.issues.ghosttyWeb = `ghostty-web is declared as a dependency: ${appPkg.dependencies["ghostty-web"]}. It is a terminal emulator component (GitHub: anomalyco/ghostty-web). In WSL/CI environments, it will fail to resolve or install because it requires native binaries (macOS or Linux desktop libs). Tests that import ghostty-web will fail in these environments.`

    // Check its actual install state
    const ghosttyPath = resolve(ROOT, "node_modules/ghostty-web")
    if (existsSync(ghosttyPath)) {
      report.issues.ghosttyWeb += " Currently INSTALLED in node_modules."
    } else {
      report.issues.ghosttyWeb += " NOT INSTALLED in node_modules (expected in CI/WSL)."
    }
  }
}

// Detect desktop-only path dependencies in test files
const desktopPatterns = [
  "../../../desktop/",
  "../../desktop/",
  "../desktop/",
  "@opencode-ai/desktop",
]
for (const [pkgName, pkgData] of Object.entries(report.packages)) {
  for (const testFile of pkgData.testFiles) {
    const content = readFileSync(testFile.path, "utf-8")
    for (const pattern of desktopPatterns) {
      if (content.includes(pattern)) {
        if (!report.issues.desktopOnlyPaths.includes(testFile.relativePath)) {
          report.issues.desktopOnlyPaths.push(testFile.relativePath)
        }
      }
    }
  }
}

// --- Execution Phase ---
console.log("\n=== Running Test Inventory ===\n")

for (const [pkgName, pkgData] of Object.entries(report.packages)) {
  for (const testFile of pkgData.testFiles) {
    // Skip execution for files with ghostty-web dependency in non-desktop context
    if (testFile.runtimeDependencies.includes("ghostty-web")) {
      testFile.execution.status = "skipped"
      testFile.execution.skipped = testFile.testCount
      report.summary.totalSkipped += testFile.testCount
      console.log(`  SKIP  ${testFile.relativePath} (ghostty-web dependency)`)
      continue
    }

    // Run the test file
    console.log(`  TEST  ${testFile.relativePath} ...`)
    try {
      const start = performance.now()
      const result = spawnSync("bun", ["test", testFile.path], {
        cwd: ROOT,
        timeout: 60000,
        env: {
          ...process.env,
          NODE_ENV: "test",
        },
        stdio: ["ignore", "pipe", "pipe"],
      })
      const duration = performance.now() - start

      const stdout = result.stdout?.toString() || ""
      const stderr = result.stderr?.toString() || ""
      const output = stdout + stderr

      if (result.status === 0) {
        testFile.execution.passed = testFile.testCount
        testFile.execution.status = "passed"
        report.summary.totalPassed += testFile.testCount
      } else {
        // Parse result for pass/fail/skip
        const passMatch = output.match(/(\d+)\s+pass/)
        const failMatch = output.match(/(\d+)\s+fail/)
        const skipMatch = output.match(/(\d+)\s+skip/)

        testFile.execution.passed = passMatch ? parseInt(passMatch[1]) : 0
        testFile.execution.failed = failMatch ? parseInt(failMatch[1]) : 0
        testFile.execution.skipped = skipMatch ? parseInt(skipMatch[1]) : 0
        testFile.execution.status = testFile.execution.failed > 0 ? "failed" : "error"
        testFile.execution.error = stderr.slice(0, 2000)

        report.summary.totalPassed += testFile.execution.passed
        report.summary.totalFailed += testFile.execution.failed
        report.summary.totalSkipped += testFile.execution.skipped

        console.log(`  FAIL  ${testFile.relativePath} (${testFile.execution.failed} failed, ${testFile.execution.passed} passed)`)
        if (testFile.execution.failed > 0) {
          // Extract specific failure lines
          const failLines = output.split("\n").filter((l) => l.includes("FAIL") || l.includes("Error:") || l.includes("expect("))
          for (const line of failLines.slice(0, 5)) {
            console.log(`    ${line.trim()}`)
          }
        }
      }

      testFile.execution.durationMs = Math.round(duration)
      report.summary.totalDurationMs += testFile.execution.durationMs

      if (result.status === 0) {
        console.log(`  PASS  ${testFile.relativePath} (${duration.toFixed(0)}ms)`)
      }

    } catch (err) {
      testFile.execution.status = "error"
      testFile.execution.error = String(err).slice(0, 1000)
      report.errors.push(`${testFile.relativePath}: ${err}`)
      console.log(`  ERROR ${testFile.relativePath}: ${err}`)
    }
  }
}

// Final summary
console.log("\n=== Test Inventory Summary ===")
console.log(`  Packages:           ${report.summary.totalPackages}`)
console.log(`  With tests:         ${report.summary.packagesWithTests}`)
console.log(`  Test files:         ${report.summary.totalTestFiles}`)
console.log(`  Test cases:         ${report.summary.totalTestCases}`)
console.log(`  Describe blocks:    ${report.summary.totalDescribeBlocks}`)
console.log(`  Passed:             ${report.summary.totalPassed}`)
console.log(`  Failed:             ${report.summary.totalFailed}`)
console.log(`  Skipped:            ${report.summary.totalSkipped}`)
console.log(`  In CI:              ${report.summary.includedInCI}`)
console.log(`  Excluded from CI:   ${report.summary.excludedFromCI}`)

if (report.issues.serverSessionFailures.length > 0) {
  console.log("\n=== server-session.test.ts Issues ===")
  for (const issue of report.issues.serverSessionFailures) {
    console.log(`  - ${issue}`)
  }
}

if (report.issues.desktopOnlyPaths.length > 0) {
  console.log("\n=== Desktop-only path dependencies ===")
  for (const path of report.issues.desktopOnlyPaths) {
    console.log(`  - ${path}`)
  }
}

// Write report
const reportDir = dirname(REPORT_PATH)
if (!existsSync(reportDir)) {
  mkdirSync(reportDir, { recursive: true })
}
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf-8")
console.log(`\nReport written to: ${REPORT_PATH}`)

// Export for other phases
export default report
