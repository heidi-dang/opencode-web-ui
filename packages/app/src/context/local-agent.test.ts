import { describe, expect, test } from "bun:test"
import { hasCustomAgent, resolveAgent } from "./local-agent"

describe("hasCustomAgent", () => {
  test("detects custom agents when any non-build/non-plan primary agent exists", () => {
    expect(hasCustomAgent([{ name: "build", mode: "primary" }, { name: "plan", mode: "primary" }])).toBe(false)
    expect(hasCustomAgent([{ name: "build" }, { name: "heidi" }])).toBe(true)
    expect(hasCustomAgent([{ name: "heidi", mode: "primary" }, { name: "orchestrator", mode: "primary" }])).toBe(true)
  })

  test("handles legacy native flag when present", () => {
    expect(hasCustomAgent([{ name: "build", native: true }, { name: "custom", native: false }])).toBe(true)
    expect(hasCustomAgent([{ name: "build", native: true }])).toBe(false)
  })

  test("ignores empty lists", () => {
    expect(hasCustomAgent([])).toBe(false)
  })
})

describe("resolveAgent", () => {
  const agents = [{ name: "heidi" }, { name: "orchestrator" }, { name: "build" }, { name: "plan" }]

  test("uses the explicitly requested available agent", () => {
    expect(resolveAgent(agents, "orchestrator")?.name).toBe("orchestrator")
    expect(resolveAgent(agents, "build")?.name).toBe("build")
  })

  test("uses backend default_agent when no explicit valid agent is requested", () => {
    expect(resolveAgent(agents, undefined, "heidi")?.name).toBe("heidi")
    expect(resolveAgent(agents, "missing", "orchestrator")?.name).toBe("orchestrator")
  })

  test("falls back to build when default_agent is missing and build is available", () => {
    expect(resolveAgent(agents)?.name).toBe("build")
    expect(resolveAgent(agents, "missing")?.name).toBe("build")
    expect(resolveAgent(agents, undefined, "missing_default")?.name).toBe("build")
  })

  test("uses first available agent when neither requested, default_agent, nor build exists", () => {
    expect(resolveAgent([{ name: "heidi" }, { name: "orchestrator" }], "missing", "invalid")?.name).toBe("heidi")
  })

  test("does not depend on agent array ordering to select backend default_agent", () => {
    const reversed = [{ name: "plan" }, { name: "build" }, { name: "orchestrator" }, { name: "heidi" }]
    expect(resolveAgent(reversed, undefined, "heidi")?.name).toBe("heidi")
    expect(resolveAgent(reversed, undefined, "orchestrator")?.name).toBe("orchestrator")
  })

  test("V2 agent without native flag is selectable and not dependent on literal name", () => {
    const v2Agents = [
      { name: "custom-agent-alpha", mode: "primary", hidden: false },
      { name: "build", mode: "primary", hidden: false },
    ]
    expect(resolveAgent(v2Agents, "custom-agent-alpha")?.name).toBe("custom-agent-alpha")
    expect(resolveAgent(v2Agents, undefined, "custom-agent-alpha")?.name).toBe("custom-agent-alpha")
  })

  test("explicit session selection wins over backend default", () => {
    expect(resolveAgent(agents, "build", "heidi")?.name).toBe("build")
    expect(resolveAgent(agents, "orchestrator", "heidi")?.name).toBe("orchestrator")
  })

  test("persisted valid session selection survives reload", () => {
    const persistedAgent = "orchestrator"
    expect(resolveAgent(agents, persistedAgent, "heidi")?.name).toBe("orchestrator")
  })

  test("missing saved agent falls back to backend default", () => {
    const missingSavedAgent = "nonexistent-agent"
    expect(resolveAgent(agents, missingSavedAgent, "heidi")?.name).toBe("heidi")
  })

  test("no configured default falls back to first visible primary or build", () => {
    const withoutBuild = [{ name: "primary-1" }, { name: "primary-2" }]
    expect(resolveAgent(withoutBuild, undefined, undefined)?.name).toBe("primary-1")
    expect(resolveAgent(agents, undefined, undefined)?.name).toBe("build")
  })
})
