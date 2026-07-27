#!/usr/bin/env bun
/**
 * Phase 2 — Test Inventory
 *
 * Discovers test files across all workspace packages and optionally runs them.
 *
 * Usage:
 *   bun scripts/audit/test-inventory.ts --help
 *   bun scripts/audit/test-inventory.ts --inventory-only
 *   bun scripts/audit/test-inventory.ts --execute
 *   bun scripts/audit/test-inventory.ts --entry <package>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { resolve, relative, basename } from "node:path"
import { spawnSync } from "node:child_process"

// ── Paths ────────────────────────────────────────────────────────────────────
const ROOT = resolve(import.meta.dirname, "../..")
const WORKSPACE_DIR = resolve(ROOT, "packages")
const SUMMARY_DIR = resolve(ROOT, "artifacts/test-inventory")
const SUMMARY_PATH = resolve(SUMMARY_DIR, "phase-2-summary.json")
const CI_FILE = resolve(ROOT, ".github/workflows/ci.yml")

const ciContent = existsSync(CI_FILE) ? readFileSync(CI_FILE, "utf-8") : ""

// ── Types ────────────────────────────────────────────────────────────────────
type PackageInfo = {
  name: string
  path: string
  testCommand?: string
  hasTestScript: boolean
}

interface PackageInventory {
  name: string
  path: string
  testCommand: string | null
  testFiles: string[]
  preloadConfig: string | null
  ciJob: string
  envRequirements: string[]
  hasTestScript: boolean
}

interface InventoryReport {
  workspacePackages: number
  packagesWithTests: number
  packagesWithoutTests: number
  packages: PackageInventory[]
}

interface ExecutionResult {
  package: string
  passed: number
  failed: number
  skipped: number
  total: number
  durationMs: number
  status: "passed" | "failed" | "skipped" | "error"
  error?: string
}

// ── Arg Parsing ──────────────────────────────────────────────────────────────
interface CliArgs {
  help: boolean
  inventoryOnly: boolean
  execute: boolean
  entry: string | undefined
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  const result: CliArgs = { help: false, inventoryOnly: false, execute: false, entry: undefined }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case "--help":
      case "-h":
        result.help = true
        break
      case "--inventory-only":
        result.inventoryOnly = true
        break
      case "--execute":
        result.execute = true
        break
      case "--entry":
        if (i + 1 >= args.length) {
          console.error("Error: --entry requires a package name argument")
          process.exit(1)
        }
        result.entry = args[++i]
        break
      default:
        console.error(`Error: unknown option "${arg}"`)
        printUsage()
        process.exit(1)
    }
  }

  return result
}

function printUsage(): void {
  console.log(`Usage: test-inventory.ts [options]

Options:
  --inventory-only   Discover test files and package commands (no execution)
  --execute          Run tests package-by-package with correct preload/env
  --entry <package>  Run tests for a single package only
  --help, -h         Show this help message

Examples:
  bun scripts/audit/test-inventory.ts --inventory-only
  bun scripts/audit/test-inventory.ts --execute
  bun scripts/audit/test-inventory.ts --entry client
`)
}

// ── Discovery ────────────────────────────────────────────────────────────────

/** Recursively find test files in a directory. */
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

/** Read package.json for a workspace package. */
function readPackageJson(pkgDir: string): PackageInfo | null {
  const pkgPath = resolve(pkgDir, "package.json")
  if (!existsSync(pkgPath)) return null
  try {
    const content = JSON.parse(readFileSync(pkgPath, "utf-8"))
    const scripts: Record<string, string> = content.scripts || {}
    return {
      name: content.name || basename(pkgDir),
      path: pkgDir,
      testCommand: scripts.test || undefined,
      hasTestScript: !!scripts.test,
    }
  } catch {
    return null
  }
}

/** Get the short package name (strip @scope/ prefix). */
function shortName(pkgName: string): string {
  const idx = pkgName.indexOf("/")
  return idx >= 0 ? pkgName.slice(idx + 1) : pkgName
}

/** Determine which CI job owns this package's tests. */
function getCiJob(pkgName: string): string {
  const short = shortName(pkgName)
  if (short === "app") return "unit / browser"
  const matrixPkgs = [
    "client", "core", "effect-drizzle-sqlite", "http-recorder",
    "httpapi-codegen", "llm", "sdk", "session-ui", "ui",
  ]
  return matrixPkgs.includes(short) ? "workspace-test-matrix" : "none"
}

/** Determine environment requirements for a package. */
function getEnvRequirements(pkgName: string): string[] {
  const reqs = ["bun"]
  if (shortName(pkgName) === "app") {
    reqs.push("happydom (preload)")
    reqs.push("browser environment for browser tests")
  }
  return reqs
}

/** Determine preload config for a package. */
function getPreloadConfig(pkgName: string): string | null {
  if (shortName(pkgName) === "app") return "happydom.ts"
  return null
}

/** Discover all workspace packages and their test files. */
function discoverPackages(): PackageInventory[] {
  const workspaceDirs = readdirSync(WORKSPACE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => resolve(WORKSPACE_DIR, d.name))

  const inventories: PackageInventory[] = []

  for (const pkgDir of workspaceDirs) {
    const pkgInfo = readPackageJson(pkgDir)
    const pkgName = pkgInfo?.name || basename(pkgDir)
    const testFiles = findTestFiles(pkgDir).map((fp) => relative(ROOT, fp))

    // Always include packages with test files OR a test script
    if (testFiles.length === 0 && !pkgInfo?.hasTestScript) continue

    inventories.push({
      name: pkgName,
      path: relative(ROOT, pkgDir),
      testCommand: pkgInfo?.testCommand ?? null,
      testFiles,
      preloadConfig: getPreloadConfig(pkgName),
      ciJob: getCiJob(pkgName),
      envRequirements: getEnvRequirements(pkgName),
      hasTestScript: pkgInfo?.hasTestScript ?? false,
    })
  }

  return inventories
}

// ── Execution ────────────────────────────────────────────────────────────────

/** Parse bun test output and return structured result. */
function parseTestOutput(
  result: { status: number | null; stdout: Buffer; stderr: Buffer },
  durationMs: number,
  label: string,
): ExecutionResult {
  const stdout = result.stdout?.toString() || ""
  const stderr = result.stderr?.toString() || ""
  const output = stdout + stderr

  // Try to parse bun test summary lines: "N pass", "M fail", "K skip"
  const passMatch = output.match(/(\d+)\s+pass/)
  const failMatch = output.match(/(\d+)\s+fail/)
  const skipMatch = output.match(/(\d+)\s+skip/)

  let passed = passMatch ? parseInt(passMatch[1], 10) : 0
  let failed = failMatch ? parseInt(failMatch[1], 10) : 0
  let skipped = skipMatch ? parseInt(skipMatch[1], 10) : 0

  // Fallback: count result lines directly if no summary matched
  if (!passMatch && result.status === 0 && output.includes("✓")) {
    const lines = output.split("\n")
    passed = lines.filter((l) => l.includes("✓")).length
    failed = lines.filter((l) => l.includes("✗")).length
    skipped = lines.filter((l) => l.includes("···")).length
  }

  const total = passed + failed + skipped

  let status: ExecutionResult["status"]
  if (result.status === 0 && failed === 0) {
    status = "passed"
  } else if (result.status === 0 && failed > 0) {
    status = "failed"
  } else {
    status = failed > 0 ? "failed" : "error"
  }

  let error: string | undefined
  if (status !== "passed") {
    error = stderr.slice(0, 1000)
    const failLines = output.split("\n").filter(
      (l: string) => l.includes("FAIL") || l.includes("Error:") || l.includes("expect("),
    )
    if (failLines.length > 0) {
      console.log(`    ${label}:`)
      for (const line of failLines.slice(0, 5)) {
        console.log(`      ${line.trim()}`)
      }
    }
  }

  return { package: label, passed, failed, skipped, total, durationMs: Math.round(durationMs), status, error }
}

/** Run tests for the app package (unit + browser separately). */
function runAppTests(pkg: PackageInventory): ExecutionResult {
  console.log(`\n  TEST  ${pkg.name} (unit + browser) ...`)
  const pkgDir = resolve(ROOT, pkg.path)

  // Unit tests
  console.log(`    UNIT ${pkg.name}/src ...`)
  const uStart = performance.now()
  const uResult = spawnSync("bun", ["test", "--preload", "./happydom.ts", "./src"], {
    cwd: pkgDir,
    timeout: 120_000,
    env: { ...process.env as Record<string, string>, NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const uDur = performance.now() - uStart
  const unitRes = parseTestOutput(uResult, uDur, `${pkg.name} unit`)

  // Browser tests
  console.log(`    BROWSER ${pkg.name}/test-browser ...`)
  const bStart = performance.now()
  const bResult = spawnSync("bun", ["test", "--conditions=browser", "--preload", "./happydom.ts", "./test-browser"], {
    cwd: pkgDir,
    timeout: 120_000,
    env: { ...process.env as Record<string, string>, NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const bDur = performance.now() - bStart
  const browserRes = parseTestOutput(bResult, bDur, `${pkg.name} browser`)

  // Aggregate
  const passed = (unitRes.passed ?? 0) + (browserRes.passed ?? 0)
  const failed = (unitRes.failed ?? 0) + (browserRes.failed ?? 0)
  const skipped = (unitRes.skipped ?? 0) + (browserRes.skipped ?? 0)
  const total = passed + failed + skipped
  const durationMs = (unitRes.durationMs ?? 0) + (browserRes.durationMs ?? 0)

  const unitOk = unitRes.status === "passed"
  const browserOk = browserRes.status === "passed"

  let status: ExecutionResult["status"] = "passed"
  if (failed > 0 || !unitOk || !browserOk) {
    status = "failed"
  }

  if (status === "passed") {
    console.log(`  PASS  ${pkg.name} (${durationMs}ms, ${total} tests)`)
  } else {
    console.log(`  FAIL  ${pkg.name} (${failed} failed, ${passed} passed, ${durationMs}ms)`)
  }

  const errors = [unitRes.error, browserRes.error].filter(Boolean) as string[]
  const error = errors.length > 0 ? errors.join("\n").slice(0, 1000) : undefined

  return { package: pkg.name, passed, failed, skipped, total, durationMs, status, error }
}

/** Run tests for a single package. */
function runPackageTests(pkg: PackageInventory): ExecutionResult {
  if (shortName(pkg.name) === "app") {
    return runAppTests(pkg)
  }

  const pkgDir = resolve(ROOT, pkg.path)
  console.log(`  TEST  ${pkg.name} (${pkg.testCommand || "bun test"}) ...`)

  const env: Record<string, string> = { ...process.env as Record<string, string>, NODE_ENV: "test" }
  const start = performance.now()

  let result: { status: number | null; stdout: Buffer; stderr: Buffer }

  if (pkg.testCommand) {
    // Use the package's own test command (e.g. "bun test --timeout 30000 --only-failures")
    const [cmd, ...cmdArgs] = pkg.testCommand.split(/\s+/)
    result = spawnSync(cmd, cmdArgs, {
      cwd: pkgDir,
      timeout: 120_000,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
  } else {
    // No test script — run bun test directly
    result = spawnSync("bun", ["test"], {
      cwd: pkgDir,
      timeout: 120_000,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    })
  }

  const duration = performance.now() - start
  const parsed = parseTestOutput(result, duration, pkg.name)

  if (parsed.status === "passed") {
    console.log(`  PASS  ${pkg.name} (${parsed.durationMs}ms, ${parsed.total} tests)`)
  } else {
    console.log(`  FAIL  ${pkg.name} (${parsed.failed} failed, ${parsed.passed} passed, ${parsed.durationMs}ms)`)
  }

  return parsed
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs()

  // If no actionable flag or --help, show usage
  if (args.help || (!args.inventoryOnly && !args.execute && !args.entry)) {
    printUsage()
    process.exit(args.help ? 0 : 1)
  }

  // ── Inventory-only mode ──────────────────────────────────────────────────
  if (args.inventoryOnly) {
    console.log("Discovering test files across workspace packages ...")
    const packages = discoverPackages()

    const withTests = packages.filter((p) => p.testFiles.length > 0)
    const scriptOnly = packages.filter((p) => p.testFiles.length === 0 && p.hasTestScript)

    const report: InventoryReport = {
      workspacePackages: packages.length,
      packagesWithTests: withTests.length,
      packagesWithoutTests: scriptOnly.length,
      packages,
    }

    // Write summary file — no timestamps, no absolute paths
    if (!existsSync(SUMMARY_DIR)) {
      mkdirSync(SUMMARY_DIR, { recursive: true })
    }
    writeFileSync(SUMMARY_PATH, JSON.stringify(report, null, 2), "utf-8")

    console.log(`  Packages:        ${report.workspacePackages}`)
    console.log(`  With tests:      ${report.packagesWithTests}`)
    console.log(`  Script only:     ${report.packagesWithoutTests}`)
    console.log(`  Total test files: ${withTests.reduce((s, p) => s + p.testFiles.length, 0)}`)
    console.log(`\n  Summary written to: artifacts/test-inventory/phase-2-summary.json`)
  }

  // ── Execute mode ─────────────────────────────────────────────────────────
  if (args.execute || args.entry) {
    const packages = discoverPackages()
    let targets = packages.filter((p) => p.hasTestScript || p.testFiles.length > 0)

    if (args.entry) {
      const entry = args.entry
      const normalized = packages.find(
        (p) => p.name === entry || shortName(p.name) === entry || p.path.endsWith(`/${entry}`),
      )
      if (!normalized) {
        console.error(`Error: package "${entry}" not found in workspace`)
        process.exit(1)
      }
      targets = [normalized]
    }

    console.log("\n=== Running Tests ===\n")

    let anyFailure = false
    const results: ExecutionResult[] = []

    for (const pkg of targets) {
      const result = runPackageTests(pkg)
      results.push(result)
      if (result.status !== "passed") {
        anyFailure = true
      }
    }

    // Summary
    const totalPassed = results.reduce((s, r) => s + r.passed, 0)
    const totalFailed = results.reduce((s, r) => s + r.failed, 0)
    const totalSkipped = results.reduce((s, r) => s + r.skipped, 0)
    const totalTests = totalPassed + totalFailed + totalSkipped

    console.log("\n=== Test Execution Summary ===")
    console.log(`  Packages executed: ${results.length}`)
    console.log(`  Passed:            ${results.filter((r) => r.status === "passed").length}`)
    console.log(`  Failed:            ${results.filter((r) => r.status === "failed").length}`)
    console.log(`  Errors:            ${results.filter((r) => r.status === "error").length}`)
    console.log("")
    console.log(`  Tests passed:      ${totalPassed}`)
    console.log(`  Tests failed:      ${totalFailed}`)
    console.log(`  Tests skipped:     ${totalSkipped}`)
    console.log(`  Tests total:       ${totalTests}`)

    if (totalTests > 0) {
      const reconciled = totalPassed + totalFailed + totalSkipped
      console.log(`  Reconciled:        ${totalPassed} + ${totalFailed} + ${totalSkipped} = ${reconciled} ${reconciled === totalTests ? "✓" : "✗ MISMATCH"}`)
    }

    if (anyFailure) {
      console.log("\n  Result: FAIL — blocking failures detected")
      process.exit(1)
    }

    console.log("\n  Result: PASS — all tests passed")
  }
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
