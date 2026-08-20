import { describe, expect, test } from "bun:test"
import { dict } from "@/i18n/en"

const requiredEnglishKeys = [
  "autonomousWorkspace.title",
  "autonomousWorkspace.description",
  "autonomousWorkspace.views.label",
  "autonomousWorkspace.views.conversation",
  "autonomousWorkspace.views.lineage",
  "autonomousWorkspace.views.timeline",
  "autonomousWorkspace.views.changes",
  "autonomousWorkspace.views.context",
  "autonomousWorkspace.lineage.title",
  "autonomousWorkspace.lineage.description",
  "autonomousWorkspace.lineage.unavailable",
  "autonomousWorkspace.timeline.title",
  "autonomousWorkspace.timeline.description",
  "autonomousWorkspace.timeline.empty",
  "autonomousWorkspace.context.title",
  "autonomousWorkspace.context.description",
  "autonomousWorkspace.common.unavailable",
  "autonomousWorkspace.changes.title",
  "autonomousWorkspace.changes.description",
  "autonomousWorkspace.changes.empty",
] as const

describe("autonomous workspace English presentation copy", () => {
  test("defines every visible workspace surface through the typed English dictionary", () => {
    for (const key of requiredEnglishKeys) {
      expect(dict[key]).toBeString()
      expect(dict[key].trim()).not.toBe("")
    }
  })
})
