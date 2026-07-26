#!/usr/bin/env bun
/**
 * upstream-diff.mjs — Compare local files against official OpenCode reference.
 *
 * Reads the reference SHA from docs/upstream/opencode-reference.json,
 * then diffs the key files between the local repo and the upstream checkout.
 */

import { readFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, "../..")
const REF_FILE = resolve(REPO_ROOT, "docs/upstream/opencode-reference.json")

if (!existsSync(REF_FILE)) {
  console.error("Reference file not found:", REF_FILE)
  process.exit(1)
}

const ref = JSON.parse(readFileSync(REF_FILE, "utf-8"))
const WORKSPACE_ROOT = resolve(REPO_ROOT, "..")
const UPSTREAM_DIR = resolve(WORKSPACE_ROOT, "opencode-official-reference")

console.log("OpenCode reference diff tool")
console.log("=" .repeat(60))
console.log("Local repo:", REPO_ROOT)
console.log("Upstream:", UPSTREAM_DIR)
console.log("Reference SHA:", ref.commit)
console.log("Local base:", ref.localBaseCommit)
console.log("")

const FILES_TO_COMPARE = [
  "packages/app/vite.config.ts",
  "packages/app/vite.js",
  "packages/app/src/app.tsx",
  "packages/app/src/entry.tsx",
  "packages/app/src/context/server.tsx",
  "packages/app/src/utils/server-health.ts",
  "packages/app/package.json",
]

let diffCount = 0
let sameCount = 0

for (const file of FILES_TO_COMPARE) {
  const localPath = resolve(REPO_ROOT, file)
  const upstreamPath = resolve(UPSTREAM_DIR, file)

  const localExists = existsSync(localPath)
  const upstreamExists = existsSync(upstreamPath)

  if (!localExists && !upstreamExists) {
    console.log(`[SKIP] ${file} — not found in either`)
    continue
  }

  if (!localExists) {
    console.log(`[LOCAL_ONLY] ${file} — only in upstream`)
    diffCount++
    continue
  }

  if (!upstreamExists) {
    console.log(`[UPSTREAM_ONLY] ${file} — only in local`)
    diffCount++
    continue
  }

  const localContent = readFileSync(localPath, "utf-8")
  const upstreamContent = readFileSync(upstreamPath, "utf-8")

  if (localContent === upstreamContent) {
    console.log(`[SAME] ${file}`)
    sameCount++
  } else {
    console.log(`[DIFF] ${file}`)
    diffCount++
  }
}

console.log("")
console.log("Summary:")
console.log(`  Identical: ${sameCount}`)
console.log(`  Different: ${diffCount}`)
console.log(`  Total:     ${sameCount + diffCount}`)
console.log("")
console.log("Note: Local standalone adaptations are expected differences.")
console.log("Phase 1 will align the security-critical ones.")

// Show the diff for vite.config.ts in detail
const localVC = resolve(REPO_ROOT, "packages/app/vite.config.ts")
const upstreamVC = resolve(UPSTREAM_DIR, "packages/app/vite.config.ts")
if (existsSync(localVC) && existsSync(upstreamVC)) {
  console.log("")
  console.log("vite.config.ts diff (local vs upstream):")
  try {
    const diff = execSync(`diff -u "${upstreamVC}" "${localVC}"`, { encoding: "utf-8", maxBuffer: 1024 * 1024 })
    console.log(diff)
  } catch (e) {
    // diff returns non-zero when files differ, which is expected
    const output = e.stdout || ""
    if (output) console.log(output)
    else console.log("(diff produced no output)")
  }
}
