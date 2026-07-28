import { describe, expect, test } from "bun:test"
import { parseAuditLog, summarizeAudit } from "./audit-parser"

describe("parseAuditLog", () => {
  test("parses valid JSONL lines", () => {
    const content = [
      JSON.stringify({ timestamp: 1000, session: "ses_1", tool: "fdx-read", decision: "approve" }),
      JSON.stringify({ timestamp: 2000, session: "ses_1", tool: "bash", decision: "block", reason: "not in allowlist" }),
      JSON.stringify({ timestamp: 3000, session: "ses_2", tool: "fdx-search", decision: "warn", agent: "heidi" }),
    ].join("\n")

    const events = parseAuditLog(content)

    expect(events).toHaveLength(3)
    expect(events[0]).toMatchObject({ tool: "fdx-read", decision: "approve" })
    expect(events[1]).toMatchObject({ tool: "bash", decision: "block", reason: "not in allowlist" })
    expect(events[2]).toMatchObject({ tool: "fdx-search", decision: "warn", agent: "heidi" })
  })

  test("skips malformed lines", () => {
    const content = [
      JSON.stringify({ timestamp: 1000, session: "ses_1", tool: "fdx-read", decision: "approve" }),
      "not valid json {{{",
      "",
      JSON.stringify({ timestamp: 2000, session: "ses_1", tool: "bash", decision: "block" }),
    ].join("\n")

    const events = parseAuditLog(content)

    expect(events).toHaveLength(2)
  })

  test("normalizes decision variants", () => {
    const content = [
      JSON.stringify({ timestamp: 1000, session: "s", tool: "t", decision: "blocked" }),
      JSON.stringify({ timestamp: 2000, session: "s", tool: "t", decision: "warning" }),
      JSON.stringify({ timestamp: 3000, session: "s", tool: "t", decision: "approve" }),
    ].join("\n")

    const events = parseAuditLog(content)

    expect(events[0].decision).toBe("block")
    expect(events[1].decision).toBe("warn")
    expect(events[2].decision).toBe("approve")
  })

  test("handles empty content", () => {
    expect(parseAuditLog("")).toHaveLength(0)
    expect(parseAuditLog("\n\n")).toHaveLength(0)
  })
})

describe("summarizeAudit", () => {
  test("counts decisions correctly", () => {
    const events = parseAuditLog(
      [
        JSON.stringify({ timestamp: 1, session: "s", tool: "a", decision: "approve" }),
        JSON.stringify({ timestamp: 2, session: "s", tool: "b", decision: "approve" }),
        JSON.stringify({ timestamp: 3, session: "s", tool: "c", decision: "block" }),
        JSON.stringify({ timestamp: 4, session: "s", tool: "d", decision: "warn" }),
      ].join("\n"),
    )

    const summary = summarizeAudit(events)

    expect(summary.total).toBe(4)
    expect(summary.approved).toBe(2)
    expect(summary.blocked).toBe(1)
    expect(summary.warned).toBe(1)
  })

  test("tracks per-tool breakdown", () => {
    const events = parseAuditLog(
      [
        JSON.stringify({ timestamp: 1, session: "s", tool: "fdx-read", decision: "approve" }),
        JSON.stringify({ timestamp: 2, session: "s", tool: "fdx-read", decision: "block" }),
        JSON.stringify({ timestamp: 3, session: "s", tool: "bash", decision: "block" }),
      ].join("\n"),
    )

    const summary = summarizeAudit(events)

    expect(summary.byTool["fdx-read"]).toEqual({ blocked: 1, warned: 0, approved: 1 })
    expect(summary.byTool["bash"]).toEqual({ blocked: 1, warned: 0, approved: 0 })
  })

  test("detects delegation violations and budget exceedances", () => {
    const events = parseAuditLog(
      [
        JSON.stringify({ timestamp: 1, session: "s", tool: "t", decision: "block", reason: "delegation depth exceeded" }),
        JSON.stringify({ timestamp: 2, session: "s", tool: "t", decision: "block", reason: "tool-call budget exceeded" }),
        JSON.stringify({ timestamp: 3, session: "s", tool: "t", decision: "approve" }),
      ].join("\n"),
    )

    const summary = summarizeAudit(events)

    expect(summary.delegationViolations).toBe(1)
    expect(summary.budgetExceedances).toBe(1)
  })

  test("keeps last 20 events as recent", () => {
    const lines = Array.from({ length: 30 }, (_, i) =>
      JSON.stringify({ timestamp: i, session: "s", tool: "t", decision: "approve" }),
    )

    const summary = summarizeAudit(parseAuditLog(lines.join("\n")))

    expect(summary.recentEvents).toHaveLength(20)
    expect(summary.recentEvents[0].timestamp).toBe(10)
  })
})
