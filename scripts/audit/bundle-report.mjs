#!/usr/bin/env node
/**
 * Bundle Report — Phase 3: Initial bundle and route splitting
 *
 * Analyzes the Vite build output at packages/app/dist/ and produces
 * a structured report with chunk sizes, lazy-loaded route boundaries,
 * and dependency ownership.
 *
 * Usage:
 *   bun run scripts/audit/bundle-report.mjs          # analyze dist/ for this worktree
 *   bun run scripts/audit/bundle-report.mjs --before  # compare with a previous snapshot
 *
 * Dependencies: Node 18+ (stdlib only).
 */

import { existsSync, readFileSync, statSync, readdirSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { createHash } from "node:crypto"

const DIST = join(import.meta.dirname, "../../packages/app/dist")
const SNAPSHOT_FILE = join(import.meta.dirname, ".bundle-snapshot.json")

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

// ── Analyze ──────────────────────────────────────────────────────────────────

function analyzeAssets() {
  const assetsDir = join(DIST, "assets")
  if (!existsSync(assetsDir)) {
    console.error("❌ dist/assets/ not found. Run `bun --cwd packages/app build` first.")
    process.exit(1)
  }

  const files = readdirSync(assetsDir).filter((f) => f.endsWith(".js"))

  const chunks = files.map((file) => {
    const fullPath = join(assetsDir, file)
    const stat = statSync(fullPath)
    // Read first 8KB to inspect import references
    const head = readFileSync(fullPath, "utf-8").slice(0, 8192)
    const isLazyEntry = head.includes('import("') || head.includes("import(")
    const isRouteChunk = /route|page|session|home|directory|login/i.test(file)
    return {
      file,
      size: stat.size,
      sizeGzip: 0, // would need zlib.gzipSync — skip for speed
      isLazyEntry,
      isRouteChunk,
    }
  })

  // Sort by size descending
  chunks.sort((a, b) => b.size - a.size)

  // Identify initial vs route chunks
  const totalJS = chunks.reduce((sum, c) => sum + c.size, 0)
  // The first script loaded by index.html is the entry. Vite names it index-*.js
  const entry = chunks.find((c) => c.file.startsWith("index-"))
  // Largest chunks that are NOT lazy entries = initial load
  const initialChunks = entry ? [entry] : []
  // The remaining chunks are route/feature splits
  const routeChunks = chunks.filter((c) => c !== entry && c.file !== entry?.file)
  // Largest initial = the entry chunk
  const largestInitial = entry || chunks[0]

  return {
    totalFiles: chunks.length,
    totalJSSize: totalJS,
    totalJSSizeFormatted: formatBytes(totalJS),
    entryChunk: entry
      ? { file: entry.file, size: entry.size, formatted: formatBytes(entry.size) }
      : null,
    largestInitial: largestInitial
      ? { file: largestInitial.file, size: largestInitial.size, formatted: formatBytes(largestInitial.size) }
      : null,
    initialChunks: initialChunks.length,
    routeChunks: routeChunks.length,
    routeChunkList: routeChunks.slice(0, 15).map((c) => ({
      file: c.file,
      size: formatBytes(c.size),
      lazy: c.isLazyEntry,
    })),
    allChunks: chunks.map((c) => ({
      file: c.file,
      size: formatBytes(c.size),
    })),
    summary: {
      initialJSSize: initialChunks.reduce((s, c) => s + c.size, 0),
      initialJSFormatted: formatBytes(initialChunks.reduce((s, c) => s + c.size, 0)),
      routeJSSize: routeChunks.reduce((s, c) => s + c.size, 0),
      routeJSFormatted: formatBytes(routeChunks.reduce((s, c) => s + c.size, 0)),
    },
  }
}

// ── Snapshot ─────────────────────────────────────────────────────────────────

function saveSnapshot(data) {
  const snapshot = {
    timestamp: new Date().toISOString(),
    totalJSSize: data.totalJSSize,
    entryChunkSize: data.entryChunk?.size ?? 0,
    routeChunks: data.routeChunks,
    chunkCount: data.totalFiles,
  }
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2))
  console.log(`\n📸 Snapshot saved to ${relative(process.cwd(), SNAPSHOT_FILE)}`)
}

function loadSnapshot() {
  return readJSON(SNAPSHOT_FILE)
}

// ── Report ───────────────────────────────────────────────────────────────────

function generateReport(data) {
  const lines = []
  lines.push("╔═══════════════════════════════════════════════════════════╗")
  lines.push("║  Phase 3 — Bundle Analysis Report                       ║")
  lines.push("╚═══════════════════════════════════════════════════════════╝")
  lines.push("")
  lines.push(`  Date:         ${new Date().toISOString()}`)
  lines.push(`  Dist:         ${DIST}`)
  lines.push(`  Total files:  ${data.totalFiles}`)
  lines.push(`  Total JS:     ${data.totalJSSizeFormatted}`)
  lines.push("")
  lines.push("  ── Initial Load ──")
  if (data.entryChunk) {
    lines.push(`    Entry chunk:    ${data.entryChunk.file}`)
    lines.push(`    Entry size:     ${data.entryChunk.formatted}`)
  }
  if (data.largestInitial) {
    lines.push(`    Largest chunk:  ${data.largestInitial.file}`)
    lines.push(`    Largest size:   ${data.largestInitial.formatted}`)
  }
  lines.push(`    Initial JS:     ${data.summary.initialJSFormatted}`)
  lines.push(`    Initial chunks: ${data.initialChunks}`)
  lines.push("")
  lines.push("  ── Route Splits ──")
  lines.push(`    Route chunks:   ${data.routeChunks}`)
  lines.push(`    Route JS:       ${data.summary.routeJSFormatted}`)
  lines.push("")
  lines.push("  ── Top Chunks ──")
  for (const chunk of data.allChunks.slice(0, 10)) {
    lines.push(`    ${chunk.size.padStart(10)}  ${chunk.file}`)
  }
  lines.push("")
  lines.push("  ── Route-Level Splits ──")
  for (const chunk of data.routeChunkList.slice(0, 10)) {
    lines.push(`    ${chunk.size.padStart(10)}  ${chunk.file}${chunk.lazy ? "" : " (eager)"}`)
  }

  // ── Comparison ──
  const prev = loadSnapshot()
  if (prev) {
    const diff = data.totalJSSize - prev.totalJSSize
    const entryDiff = (data.entryChunk?.size ?? 0) - prev.entryChunkSize
    lines.push("")
    lines.push("  ── vs Previous Snapshot ──")
    lines.push(`    Total JS:   ${diff > 0 ? "+" : ""}${formatBytes(diff)}`)
    lines.push(`    Entry:      ${entryDiff > 0 ? "+" : ""}${formatBytes(entryDiff)}`)
    lines.push(`    Chunks:     ${data.totalFiles - prev.chunkCount > 0 ? "+" : ""}${data.totalFiles - prev.chunkCount}`)
  }

  lines.push("")
  return lines.join("\n")
}

// ── Main ─────────────────────────────────────────────────────────────────────

const isBefore = process.argv.includes("--before")
if (isBefore) {
  const prev = loadSnapshot()
  if (prev) {
    console.log("Previous snapshot:")
    console.log(JSON.stringify(prev, null, 2))
  } else {
    console.log("No snapshot found. Run without --before first.")
  }
  process.exit(0)
}

const data = analyzeAssets()
const report = generateReport(data)
console.log(report)
saveSnapshot(data)
