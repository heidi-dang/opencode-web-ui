#!/usr/bin/env node
/**
 * Bundle Report — Phase 3: Initial bundle and route splitting
 *
 * Analyzes the Vite build output and produces a structured report with
 * chunk sizes, lazy-loaded route boundaries, and compression metrics.
 *
 * Usage:
 *   bun scripts/audit/bundle-report.mjs                         # analyze dist/ for this worktree
 *   bun scripts/audit/bundle-report.mjs --phase phase-3         # output to artifacts/performance/phase-3/
 *   bun scripts/audit/bundle-report.mjs --phase phase-3 --baseline baseline.json
 *   bun scripts/audit/bundle-report.mjs --phase phase-3 --dist packages/app/dist
 *
 * Dependencies: Node 18+ (stdlib only).
 */

import { existsSync, readFileSync, statSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import { join, dirname, relative, extname } from "node:path"
import { gzipSync, brotliCompressSync } from "node:zlib"

// ── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = { phase: "", dist: null, baseline: null, output: null, help: false }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      opts.help = true
    } else if (args[i] === "--phase") {
      opts.phase = args[++i] ?? ""
    } else if (args[i] === "--dist") {
      opts.dist = args[++i] ?? null
    } else if (args[i] === "--output") {
      opts.output = args[++i] ?? null
    } else if (args[i] === "--baseline") {
      const path = args[++i]
      if (path && existsSync(path)) opts.baseline = JSON.parse(readFileSync(path, "utf-8"))
    }
  }
  if (!opts.phase) opts.phase = "phase-3"
  if (!opts.dist) {
    opts.dist = join(process.cwd(), "packages/app/dist")
    if (!existsSync(opts.dist)) {
      opts.dist = join(import.meta.dirname, "../../packages/app/dist")
    }
  }
  return opts
}

function printHelp() {
  const help = `
Usage: bundle-report.mjs [options]

Options:
  --phase <name>       Phase label (default: "phase-3"). Used for output directory naming.
  --dist <dir>         Path to built dist directory (default: packages/app/dist relative to CWD).
  --output <file.json> Output path for the JSON report. Summary is written alongside with .summary.json suffix.
  --baseline <file>    Baseline report JSON for comparison (delta + percentage).
  --help, -h           Show this help message and exit.

Examples:
  node scripts/audit/bundle-report.mjs
  node scripts/audit/bundle-report.mjs --phase phase-3
  node scripts/audit/bundle-report.mjs --phase phase-3 --dist packages/app/dist
  node scripts/audit/bundle-report.mjs --phase phase-3 --output ./report.json
  node scripts/audit/bundle-report.mjs --phase phase-3 --baseline baseline.json
`
  console.log(help)
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes === 0) return "0 B"
  const units = ["B", "KiB", "MiB"]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const val = bytes / Math.pow(1024, i)
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return null
  }
}

function formatPercent(change, total) {
  if (!total || total === 0) return "0.0%"
  const pct = (change / total) * 100
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`
}

// ── HTML Analysis ────────────────────────────────────────────────────────────

function findHTML(distDir) {
  const htmlFile = join(distDir, "index.html")
  if (!existsSync(htmlFile)) return null
  return readFileSync(htmlFile, "utf-8")
}

function parseHTMLAssets(html) {
  if (!html) return { moduleScripts: [], stylesheets: [], modulepreloadLinks: [], inlineScripts: [] }

  const moduleScripts = []
  const stylesheets = []
  const modulepreloadLinks = []
  const inlineScripts = []

  // Match <script type="module" ... src="...">
  const scriptRe = /<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>/g
  let match
  while ((match = scriptRe.exec(html)) !== null) {
    moduleScripts.push(match[1].replace(/^\//, ""))
  }

  // Match <link rel="stylesheet" ... href="...">
  const cssRe = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/g
  while ((match = cssRe.exec(html)) !== null) {
    stylesheets.push(match[1].replace(/^\//, ""))
  }

  // Match <link rel="modulepreload" ... href="...">
  const preloadRe = /<link[^>]*rel=["']modulepreload["'][^>]*href=["']([^"']+)["'][^>]*>/g
  while ((match = preloadRe.exec(html)) !== null) {
    modulepreloadLinks.push(match[1].replace(/^\//, ""))
  }

  // Match inline scripts (scripts without src)
  const inlineRe = /<script[^>]*>([\s\S]*?)<\/script>/g
  while ((match = inlineRe.exec(html)) !== null) {
    const srcAttr = match[0].match(/src\s*=\s*["']/);
    if (!srcAttr) {
      inlineScripts.push({ content: match[1], size: Buffer.byteLength(match[1], "utf-8") })
    }
  }

  return { moduleScripts, stylesheets, modulepreloadLinks, inlineScripts }
}

// ── Asset Analysis ───────────────────────────────────────────────────────────

function analyzeAssets(distDir, html) {
  const assetsDir = join(distDir, "assets")
  if (!existsSync(assetsDir)) {
    console.error(`❌ ${assetsDir}/ not found. Run \`bun --cwd packages/app build\` first.`)
    process.exit(1)
  }

  const allFiles = readdirSync(assetsDir)
  const htmlAssets = parseHTMLAssets(html)

  // Track all assets in the build graph
  const allGraphAssets = allFiles.map((file) => {
    const fullPath = join(assetsDir, file)
    const stat = statSync(fullPath)
    const isDir = stat.isDirectory()
    if (isDir) return null
    const ext = extname(file).toLowerCase()
    const size = stat.size
    const gzip = ext === ".js" || ext === ".css" || ext === ".html" ? gzipSync(readFileSync(fullPath)).length : 0
    return {
      file,
      size,
      sizeFormatted: formatBytes(size),
      gzipSize: gzip,
      gzipFormatted: formatBytes(gzip),
      type: ext === ".js" ? "script" : ext === ".css" ? "stylesheet" : ext === ".woff2" || ext === ".woff" || ext === ".ttf" ? "font" : "other",
    }
  }).filter(Boolean)

  // HTML preloaded assets (modulepreload links)
  const htmlPreloadedAssets = htmlAssets.modulepreloadLinks.map((href) => {
    const file = href.replace(/^assets\//, "")
    const fullPath = join(assetsDir, file)
    const exists = existsSync(fullPath)
    return {
      file: href,
      size: exists ? statSync(fullPath).size : 0,
      exists,
    }
  })

  // Initial network assets — the entry module script and CSS loaded from HTML
  const initialPaths = [
    ...htmlAssets.moduleScripts,
    ...htmlAssets.stylesheets,
  ]

  const initialNetworkAssets = initialPaths.map((href) => {
    const file = href.replace(/^assets\//, "")
    const fullPath = join(assetsDir, file)
    const exists = existsSync(fullPath)
    const size = exists ? statSync(fullPath).size : 0
    const content = exists ? readFileSync(fullPath) : Buffer.alloc(0)
    const gzip = content.length > 0 ? gzipSync(content).length : 0
    return {
      file: href,
      size,
      sizeFormatted: formatBytes(size),
      gzipSize: gzip,
      gzipFormatted: formatBytes(gzip),
      exists,
    }
  })

  // Route/chunk assets — JS files that are NOT in the initial network set
  const initialFiles = new Set(initialPaths.map((p) => p.replace(/^assets\//, "")))
  const routeRequestedAssets = allGraphAssets
    .filter((a) => a.type === "script" && !initialFiles.has(a.file))
    .map((a) => ({
      file: a.file,
      size: a.size,
      sizeFormatted: a.sizeFormatted,
      gzipSize: a.gzipSize,
      gzipFormatted: a.gzipFormatted,
      isRouteChunk: true,
    }))

  // Totals
  const totalJavaScript = allGraphAssets
    .filter((a) => a.type === "script")
    .reduce((sum, a) => sum + a.size, 0)

  const initialJavaScript = initialNetworkAssets
    .filter((a) => a.file.endsWith(".js"))
    .reduce((sum, a) => sum + a.size, 0)

  // Gzip of all JS (read + compress)
  const allJSContent = allGraphAssets
    .filter((a) => a.type === "script")
    .map((a) => readFileSync(join(assetsDir, a.file)))
  const combinedJSBuffer = Buffer.concat(allJSContent)
  const gzipSize = gzipSync(combinedJSBuffer).length
  const brotliSize = brotliCompressSync(combinedJSBuffer).length

  return {
    allGraphAssets,
    htmlPreloadedAssets,
    initialNetworkAssets,
    routeRequestedAssets,
    totalJavaScript,
    initialJavaScript,
    gzipSize,
    brotliSize,
  }
}

// ── Report JSON ──────────────────────────────────────────────────────────────

function generateReport(data, opts) {
  const report = {
    phase: opts.phase,
    timestamp: new Date().toISOString(),
    dist: opts.dist,
    allGraphAssets: data.allGraphAssets.map((a) => ({
      file: a.file,
      size: a.size,
      gzipSize: a.gzipSize,
      type: a.type,
    })),
    htmlPreloadedAssets: data.htmlPreloadedAssets,
    initialNetworkAssets: data.initialNetworkAssets.map((a) => ({
      file: a.file,
      size: a.size,
      gzipSize: a.gzipSize,
    })),
    routeRequestedAssets: data.routeRequestedAssets.map((a) => ({
      file: a.file,
      size: a.size,
      gzipSize: a.gzipSize,
    })),
    totalJavaScript: data.totalJavaScript,
    initialJavaScript: data.initialJavaScript,
    gzipSize: data.gzipSize,
    brotliSize: data.brotliSize,
  }

  if (opts.baseline) {
    const baseline = opts.baseline
    const totalJSDiff = data.totalJavaScript - (baseline.totalJavaScript ?? 0)
    const initialJSDiff = data.initialJavaScript - (baseline.initialJavaScript ?? 0)
    const gzipDiff = data.gzipSize - (baseline.gzipSize ?? 0)
    const brotliDiff = data.brotliSize - (baseline.brotliSize ?? 0)
    report.baseline = {
      totalJavaScriptDiff: totalJSDiff,
      initialJavaScriptDiff: initialJSDiff,
      gzipSizeDiff: gzipDiff,
      brotliSizeDiff: brotliDiff,
      totalJavaScriptDiffFormatted: formatBytes(Math.abs(totalJSDiff)),
      initialJavaScriptDiffFormatted: formatBytes(Math.abs(initialJSDiff)),
      gzipSizeDiffFormatted: formatBytes(Math.abs(gzipDiff)),
      brotliSizeDiffFormatted: formatBytes(Math.abs(brotliDiff)),
      totalJavaScriptPct: formatPercent(totalJSDiff, baseline.totalJavaScript ?? 0),
      initialJavaScriptPct: formatPercent(initialJSDiff, baseline.initialJavaScript ?? 0),
      gzipSizePct: formatPercent(gzipDiff, baseline.gzipSize ?? 0),
      brotliSizePct: formatPercent(brotliDiff, baseline.brotliSize ?? 0),
    }
  }

  return report
}

function generateSummary(report) {
  return {
    phase: report.phase,
    timestamp: report.timestamp,
    totalJavaScript: report.totalJavaScript,
    initialJavaScript: report.initialJavaScript,
    gzipSize: report.gzipSize,
    brotliSize: report.brotliSize,
    initialAssetCount: report.initialNetworkAssets.length,
    routeAssetCount: report.routeRequestedAssets.length,
    totalAssetCount: report.allGraphAssets.length,
    totalJavaScriptFormatted: formatBytes(report.totalJavaScript),
    initialJavaScriptFormatted: formatBytes(report.initialJavaScript),
    gzipSizeFormatted: formatBytes(report.gzipSize),
    brotliSizeFormatted: formatBytes(report.brotliSize),
  }
}

// ── Console Report ───────────────────────────────────────────────────────────

function printConsoleSummary(report, data) {
  const lines = []
  lines.push("╔═══════════════════════════════════════════════════════════╗")
  lines.push(`║  ${report.phase.padEnd(20)} — Bundle Analysis Report           ║`)
  lines.push("╚═══════════════════════════════════════════════════════════╝")
  lines.push("")
  lines.push(`  Date:         ${report.timestamp}`)
  lines.push(`  Phase:        ${report.phase}`)
  lines.push(`  Dist:         ${report.dist}`)
  lines.push(`  Total assets: ${data.allGraphAssets.length}`)
  lines.push("")
  lines.push("  ── JavaScript ──")
  lines.push(`    Total JS:     ${formatBytes(report.totalJavaScript)}`)
  lines.push(`    Initial JS:   ${formatBytes(report.initialJavaScript)}`)
  lines.push(`    Route JS:     ${formatBytes(report.totalJavaScript - report.initialJavaScript)}`)
  lines.push("")
  lines.push("  ── Compression ──")
  lines.push(`    Gzip:         ${formatBytes(report.gzipSize)}`)
  lines.push(`    Brotli:       ${formatBytes(report.brotliSize)}`)
  lines.push("")
  lines.push("  ── Initial Network Assets ──")
  for (const a of report.initialNetworkAssets) {
    lines.push(`    ${a.file.padEnd(50)} ${formatBytes(a.size).padStart(10)}`)
  }
  lines.push("")
  lines.push("  ── Route Chunks (top 15) ──")
  for (const a of report.routeRequestedAssets.slice(0, 15)) {
    lines.push(`    ${a.file.padEnd(50)} ${formatBytes(a.size).padStart(10)}`)
  }

  if (report.baseline) {
    const b = report.baseline
    const sign = (v) => v > 0 ? "+" : v < 0 ? "-" : " "
    lines.push("")
    lines.push("  ── vs Baseline ──")
    lines.push(`    Total JS:     ${sign(b.totalJavaScriptDiff)}${b.totalJavaScriptDiffFormatted}  (${b.totalJavaScriptPct})`)
    lines.push(`    Initial JS:   ${sign(b.initialJavaScriptDiff)}${b.initialJavaScriptDiffFormatted}  (${b.initialJavaScriptPct})`)
    lines.push(`    Gzip:         ${sign(b.gzipSizeDiff)}${b.gzipSizeDiffFormatted}  (${b.gzipSizePct})`)
    lines.push(`    Brotli:       ${sign(b.brotliSizeDiff)}${b.brotliSizeDiffFormatted}  (${b.brotliSizePct})`)
  }

  lines.push("")
  return lines.join("\n")
}

// ── Main ─────────────────────────────────────────────────────────────────────

const opts = parseArgs()

if (opts.help) {
  printHelp()
  process.exit(0)
}

const html = findHTML(opts.dist)
if (!html) {
  console.error(`❌ index.html not found in ${opts.dist}. Run \`bun --cwd packages/app build\` first.`)
  process.exit(1)
}

const data = analyzeAssets(opts.dist, html)
const report = generateReport(data, opts)
const summary = generateSummary(report)

// Determine output paths
let reportPath
if (opts.output) {
  reportPath = opts.output
} else {
  const outputDir = join(process.cwd(), "artifacts", "performance", opts.phase)
  mkdirSync(outputDir, { recursive: true })
  reportPath = join(outputDir, "bundle-report.json")
}

const summaryPath = reportPath.replace(/\.json$/, ".summary.json")

mkdirSync(dirname(reportPath), { recursive: true })

writeFileSync(reportPath, JSON.stringify(report, null, 2))
writeFileSync(summaryPath, JSON.stringify(summary, null, 2))

console.log(printConsoleSummary(report, data))
console.log(`\n📄 Report written to ${relative(process.cwd(), reportPath)}`)
console.log(`📄 Summary written to ${relative(process.cwd(), summaryPath)}`)
