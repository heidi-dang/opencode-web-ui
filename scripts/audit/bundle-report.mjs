#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname, extname } from "node:path"

const args = process.argv.slice(2)
let phase = "phase-0"
let outputPath

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--phase" && args[i + 1]) {
    phase = args[i + 1]
    i++
  } else if (args[i] === "--output" && args[i + 1]) {
    outputPath = args[i + 1]
    i++
  } else if (args[i] && !args[i].startsWith("--")) {
    outputPath = args[i]
  }
}

const distDir = resolve(process.cwd(), "packages/app/dist")
const reportDir = resolve(process.cwd(), "artifacts/performance", phase)
if (!outputPath) outputPath = resolve(reportDir, "bundle-report.json")

if (!existsSync(distDir)) {
  console.error(`Build output not found at ${distDir}. Run 'bun run build' first.`)
  process.exit(1)
}

function walk(dir) {
  const files = []
  try {
    for (const entry of readdirSafe(dir)) {
      const full = resolve(dir, entry)
      const stat = statSafe(full)
      if (!stat) continue
      if (stat.isDirectory()) {
        files.push(...walk(full))
      } else {
        files.push(full)
      }
    }
  } catch {}
  return files
}

function readdirSafe(dir) {
  try { return readFileSync(dir, { withFileTypes: false }) && Array.from(new Bun.Glob("**/*").scanSync({ cwd: dir })) || [] } catch { return [] }
}

function statSafe(p) {
  try { return require("node:fs").statSync(p) } catch { return null }
}

const { readdirSync, statSync } = await import("node:fs")

function listFiles(dir, prefix = "") {
  const entries = []
  try {
    for (const name of readdirSync(dir)) {
      const full = resolve(dir, name)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        entries.push(...listFiles(full, `${prefix}${name}/`))
      } else {
        entries.push({ path: full, rel: `${prefix}${name}`, size: stat.size })
      }
    }
  } catch {}
  return entries
}

const allFiles = listFiles(distDir)
const htmlFiles = allFiles.filter(f => f.rel.endsWith(".html"))
const jsFiles = allFiles.filter(f => f.rel.endsWith(".js"))
const cssFiles = allFiles.filter(f => f.rel.endsWith(".css"))
const otherFiles = allFiles.filter(f => !f.rel.endsWith(".html") && !f.rel.endsWith(".js") && !f.rel.endsWith(".css"))

const totalJavascriptBytes = jsFiles.reduce((sum, f) => sum + f.size, 0)
const totalSize = allFiles.reduce((sum, f) => sum + f.size, 0)

let initialChunks = []
let initialJavaScriptBytes = 0

if (htmlFiles.length > 0) {
  for (const html of htmlFiles) {
    const content = readFileSync(html.path, "utf-8")
    const scriptTags = content.match(/<script[^>]+src=["']([^"']+)["'][^>]*>/gi) || []
    const moduleLinks = content.match(/<link[^>]+rel="modulepreload"[^>]+href=["']([^"']+)["'][^>]*>/gi) || []
    const moduleScripts = content.match(/<script[^>]+type="module"[^>]+src=["']([^"']+)["'][^>]*>/gi) || []

    for (const tag of [...scriptTags, ...moduleLinks, ...moduleScripts]) {
      const srcMatch = tag.match(/src=["']([^"']+)["']/) || tag.match(/href=["']([^"']+)["']/)
      if (srcMatch) {
        const src = srcMatch[1]
        const resolved = allFiles.find(f => f.rel === src || f.path.endsWith(src))
        if (resolved) {
          initialChunks.push(resolved.rel)
          initialJavaScriptBytes += resolved.size
        }
      }
    }

    const inlineScripts = content.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || []
    for (const script of inlineScripts) {
      const scriptContent = script.replace(/<\/?script[^>]*>/g, "")
      initialJavaScriptBytes += new TextEncoder().encode(scriptContent).length
    }
  }
}

if (initialChunks.length === 0) {
  const extMap = {}
  for (const f of jsFiles) {
    const name = f.rel.replace(/\.\w+$/, "")
    const ext = extname(f.rel)
    if (!extMap[name]) extMap[name] = []
    extMap[name].push(f)
  }

  const isEntry = {}
  for (const f of jsFiles) {
    const content = readFileSync(f.path, "utf-8")
    if (content.includes("import(") || content.includes("import.meta.url")) {
      isEntry[f.rel] = true
    }
  }

  if (Object.keys(isEntry).length === 0 && jsFiles.length > 0) {
    isEntry[jsFiles[0].rel] = true
  }

  initialChunks = Object.keys(isEntry)
  initialJavaScriptBytes = jsFiles
    .filter(f => isEntry[f.rel])
    .reduce((sum, f) => sum + f.size, 0)
}

const assets = []
for (const f of allFiles) {
  const type = f.rel.endsWith(".js") ? "javascript" :
    f.rel.endsWith(".css") ? "css" :
    f.rel.endsWith(".html") ? "html" : "other"
  const pct = totalJavascriptBytes > 0 && type === "javascript"
    ? ((f.size / totalJavascriptBytes) * 100)
    : totalSize > 0 ? ((f.size / totalSize) * 100) : 0

  assets.push({
    file: f.rel,
    type,
    size: f.size,
    sizeFormatted: formatSize(f.size),
    percentageOfGroup: Math.round(pct * 100) / 100,
    initial: initialChunks.includes(f.rel),
  })
}

assets.sort((a, b) => b.size - a.size)

const initialJSAssets = assets.filter(a => a.type === "javascript" && a.initial)
const initialLoadedJavaScript = initialJavaScriptBytes

const report = {
  phase,
  timestamp: new Date().toISOString(),
  summary: {
    totalFiles: allFiles.length,
    totalSize,
    totalSizeFormatted: formatSize(totalSize),
    totalJavascriptBytes,
    totalJavascriptFormatted: formatSize(totalJavascriptBytes),
    totalJavascriptFiles: jsFiles.length,
    initialJavaScriptFiles: initialChunks.length,
    initialJavaScriptBytes,
    initialJavaScriptFormatted: formatSize(initialJavaScriptBytes),
    percentInitialOfTotalJavascript: totalJavascriptBytes > 0
      ? Math.round((initialJavaScriptBytes / totalJavascriptBytes) * 10000) / 100
      : 0,
    cssFiles: cssFiles.length,
    cssBytes: cssFiles.reduce((s, f) => s + f.size, 0),
  },
  assets,
}

const summaryReport = {
  phase: report.phase,
  timestamp: report.timestamp,
  totalJavascriptBytes: report.summary.totalJavascriptBytes,
  initialJavaScriptBytes: report.summary.initialJavaScriptBytes,
  initialJavaScriptFiles: report.summary.initialJavaScriptFiles,
  totalFiles: report.summary.totalFiles,
  totalSize: report.summary.totalSize,
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf-8")

const summaryPath = outputPath.replace(/\.json$/, ".summary.json")
writeFileSync(summaryPath, JSON.stringify(summaryReport, null, 2), "utf-8")

console.log(`Bundle report written to ${outputPath}`)
console.log(`Summary written to ${summaryPath}`)
console.log(`\nSummary:`)
console.log(`  Total JS: ${formatSize(totalJavascriptBytes)} (${jsFiles.length} files)`)
console.log(`  Initial JS: ${formatSize(initialJavaScriptBytes)} (${initialChunks.length} files)`)
console.log(`  Total size: ${formatSize(totalSize)} (${allFiles.length} files)`)

function formatSize(bytes) {
  if (bytes === 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`
}
