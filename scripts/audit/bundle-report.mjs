#!/usr/bin/env bun
/**
 * bundle-report.mjs — Generate a bundle report from Vite build output.
 */

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs"
import { resolve, dirname, extname } from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync, brotliCompressSync } from "node:zlib"
import { mkdirSync } from "node:fs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "../..")
const DIST_DIR = resolve(REPO_ROOT, "packages/app/dist")

if (!existsSync(DIST_DIR)) {
  console.error("Build output not found at:", DIST_DIR)
  console.error("Run 'bun run build' first.")
  process.exit(1)
}

function getAllFiles(dir) {
  const files = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...getAllFiles(full))
    } else if (entry.isFile()) {
      try {
        // Verify file is accessible (skip broken symlinks)
        statSync(full)
        files.push(full)
      } catch {
        // skip broken symlinks
      }
    }
  }
  return files
}

const files = getAllFiles(DIST_DIR)
const assetExtensions = new Set([".js", ".css", ".wasm", ".woff", ".woff2", ".ttf", ".otf", ".html"])

const assets = []
let totalRaw = 0
let totalGzip = 0
let totalBrotli = 0
let totalJS = 0

for (const file of files) {
  const ext = extname(file)
  if (!assetExtensions.has(ext)) continue

  let stat
  try {
    stat = statSync(file)
  } catch {
    continue
  }
  if (!stat.isFile()) continue

  const raw = stat.size
  totalRaw += raw

  const content = readFileSync(file)
  const gzipped = gzipSync(content).length
  totalGzip += gzipped

  let brotli = 0
  try {
    brotli = brotliCompressSync(content).length
    totalBrotli += brotli
  } catch {
    brotli = gzipped
    totalBrotli += brotli
  }

  const relative = file.replace(DIST_DIR + "/", "")
  const isJS = ext === ".js"
  const isInitialJS = relative === "index.html" || relative === "assets/index.js" || /assets\/index-[a-zA-Z0-9-]+\.js$/.test(relative)
  let feature = "Other"
  if (isJS) {
    if (relative.includes("ghostty")) feature = "Ghostty terminal"
    else if (relative.includes("directory")) feature = "Directory dialog"
    else if (relative.includes("shiki") || relative.includes("shikijs")) feature = "Syntax highlighter"
    else if (relative.includes("wasm")) feature = "WASM binary"
    else feature = "JavaScript chunk"
  } else if (ext === ".css") feature = "Styles"
  else if (ext === ".html") feature = "Entry HTML"
  else if (ext === ".wasm") feature = "WASM binary"
  else if ([".woff", ".woff2", ".ttf", ".otf"].includes(ext)) feature = "Font"

  if (isJS) totalJS += raw

  assets.push({
    file: relative,
    ext,
    rawBytes: raw,
    gzipBytes: gzipped,
    brotliBytes: brotli,
    pctOfTotalJS: isJS ? ((raw / totalJS) * 100).toFixed(1) + "%" : "N/A",
    initialRoute: isInitialJS ? "Yes" : "No",
    feature,
  })
}

assets.sort((a, b) => b.rawBytes - a.rawBytes)

const report = {
  generatedAt: new Date().toISOString(),
  distDir: DIST_DIR,
  totalAssets: assets.length,
  totalRawBytes: totalRaw,
  totalGzipBytes: totalGzip,
  totalBrotliBytes: totalBrotli,
  totalJSBytes: totalJS,
  assets,
}

const reportFile = resolve(REPO_ROOT, "artifacts/performance/phase-0/bundle-report.json")
const reportDir = dirname(reportFile)
if (!existsSync(reportDir)) {
  mkdirSync(reportDir, { recursive: true })
}

Bun.write(reportFile, JSON.stringify(report, null, 2))

console.log("Bundle report generated:")
console.log("  Assets:", report.totalAssets)
console.log("  Total raw:", (report.totalRawBytes / 1024 / 1024).toFixed(2), "MB")
console.log("  Total gzip:", (report.totalGzipBytes / 1024 / 1024).toFixed(2), "MB")
console.log("  Total brotli:", (report.totalBrotliBytes / 1024 / 1024).toFixed(2), "MB")
console.log("  Total JS:", (report.totalJSBytes / 1024 / 1024).toFixed(2), "MB")
console.log("  Report saved to:", reportFile)

console.log("\nTop 10 largest assets:")
assets.slice(0, 10).forEach((a, i) => {
  console.log(" ", (i + 1) + ".", a.file)
  console.log("     raw:", (a.rawBytes / 1024).toFixed(1), "KB | gzip:", (a.gzipBytes / 1024).toFixed(1), "KB")
})

// Verify known audit claims
console.log("\n=== Audit Claim Verification ===")
const mainEntry = assets.find(a => a.initialRoute === "Yes" && a.ext === ".js")
if (mainEntry) {
  const rawMB = (mainEntry.rawBytes / 1024 / 1024).toFixed(2)
  const gzipMB = (mainEntry.gzipBytes / 1024 / 1024).toFixed(2)
  console.log("Main entry:", rawMB, "MB raw /", gzipMB, "MB gzip (claim: 3.18 MB / 936 KB)")
  const r = parseFloat(rawMB) >= 3.0 && parseFloat(rawMB) <= 3.5 ? "Confirmed" : "Different"
  console.log("  Status:", r)
}

const ghostty = assets.find(a => a.feature === "Ghostty terminal")
if (ghostty) {
  console.log("Ghostty:", (ghostty.rawBytes / 1024).toFixed(1), "KB raw /", (ghostty.gzipBytes / 1024).toFixed(1), "KB gzip (claim: 1.38 MB / 424 KB)")
  const r = ghostty.rawBytes > 500000 && ghostty.rawBytes < 1500000 ? "Confirmed" : "Different"
  console.log("  Status:", r)
}

const dirDialog = assets.find(a => a.feature === "Directory dialog")
if (dirDialog) {
  console.log("Directory dialog:", (dirDialog.rawBytes / 1024).toFixed(1), "KB (claim: 258 KB)")
  const r = dirDialog.rawBytes > 200000 && dirDialog.rawBytes < 300000 ? "Confirmed" : "Different"
  console.log("  Status:", r)
}

const wasmAssets = assets.filter(a => a.ext === ".wasm")
if (wasmAssets.length > 0) {
  const totalWasm = wasmAssets.reduce((s, a) => s + a.rawBytes, 0)
  console.log("WASM total:", (totalWasm / 1024).toFixed(1), "KB (claim: 622 KB)")
  const r = totalWasm > 500000 && totalWasm < 800000 ? "Confirmed" : "Different"
  console.log("  Status:", r)
}
