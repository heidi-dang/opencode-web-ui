import { readFileSync } from "node:fs"
import { parseDocument } from "yaml"

const file = process.argv[2] ?? ".github/workflows/ci.yml"
const document = parseDocument(readFileSync(file, "utf8"), { uniqueKeys: true })
if (document.errors.length > 0) {
  for (const error of document.errors) console.error(error.message)
  process.exit(1)
}

const workflow = document.toJS() as { jobs?: Record<string, unknown> }
const jobs = new Set(Object.keys(workflow.jobs ?? {}))
const required = ["quality", "unit", "browser", "official-smoke", "stability", "build", "phase-3-production-network"]
const missing = required.filter((job) => !jobs.has(job))
if (missing.length > 0) {
  console.error(`Missing required CI jobs: ${missing.join(", ")}`)
  process.exit(1)
}

console.log(`Valid CI workflow: ${file} (${jobs.size} jobs)`)
