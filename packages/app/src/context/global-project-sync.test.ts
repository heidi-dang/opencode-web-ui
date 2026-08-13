import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"

const source = readFileSync(new URL("./global.tsx", import.meta.url), "utf8")

describe("server project catalog sync", () => {
  it("merges catalog projects without mutating persisted project state", () => {
    expect(source).toContain("const catalog = sync.data.project")
    expect(source).not.toContain("projects.open(project.worktree)")
  })
})
