import { afterEach, describe, expect, mock, test } from "bun:test"
import { createComponent, createSignal, type JSX } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"
import { dict } from "@/i18n/en"
import type { AgentExecutionEvent, SessionLineageSnapshot } from "@/features/autonomous-workspace/contracts"
import { normalizeWorkspaceChanges } from "@/features/autonomous-workspace/contracts"

const disposals: Array<() => void> = []
;(globalThis as typeof globalThis & { React: { createElement: typeof h } }).React = { createElement: h }

function translate(key: keyof typeof dict, params?: Record<string, string | number | boolean>) {
  return dict[key].replace(/{{\s*([^}]+?)\s*}}/g, (_, name: string) => String(params?.[name] ?? ""))
}

mock.module("@/context/language", () => ({
  useLanguage: () => ({
    t: translate,
    intl: () => "en-US",
  }),
}))

const { SessionLineageCenter } = await import("@/features/autonomous-workspace/agent-command-center")
const { ExecutionTimeline } = await import("@/features/autonomous-workspace/execution-timeline")
const { AutonomousWorkspace, WorkspaceModeToggle } = await import("@/features/autonomous-workspace/workspace-shell")
const { ChangesReviewCenter, ContextIntelligence } = await import("@/features/autonomous-workspace/workspace-panels")

function mount(view: () => JSX.Element) {
  const host = document.createElement("div")
  document.body.append(host)
  const dispose = render(view, host)
  disposals.push(() => {
    dispose()
    host.remove()
  })
  return host
}

afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
})

describe("autonomous workspace presentation", () => {
  test("renders translated workspace heading and navigation at a narrow viewport", () => {
    window.innerWidth = 390
    const conversation = document.createElement("p")
    conversation.textContent = "Conversation body"
    const host = mount(() => createComponent(AutonomousWorkspace, {
      lineage: () => [],
      events: () => [],
      changes: () => [],
      usage: () => undefined,
      conversation,
    }))

    expect(host.querySelector("main")?.textContent).toContain("Autonomous workspace")
    const navigation = host.querySelector('nav[aria-label="Workspace views"]')
    expect(navigation).not.toBeNull()
    expect([...navigation!.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Conversation",
      "Session lineage",
      "Timeline",
      "Changes",
      "Context",
    ])
  })

  test("renders a safe translated timeline label as non-interactive text", () => {
    const event = {
      id: "evt-tool",
      kind: "network",
      timelineLabelKey: "autonomousWorkspace.timeline.event.tool",
      timestamp: 1,
      state: "active",
      label: "session.next.tool.called",
      detail: "secret tool input",
      output: "secret tool output",
    } as unknown as AgentExecutionEvent
    const host = mount(() => createComponent(ExecutionTimeline, { events: () => [event] }))

    expect(host.textContent).toContain("Tool activity")
    expect(host.textContent).not.toContain("session.next.tool.called")
    expect(host.textContent).not.toContain("secret tool input")
    expect(host.textContent).not.toContain("secret tool output")
    expect(host.querySelector("ol button")).toBeNull()
    expect(host.querySelector("[aria-expanded]")).toBeNull()
  })

  test("renders unresolved lineage explicitly as unavailable", () => {
    const sessions = [{ id: "orphan", parentId: "missing", label: "Orphan session", relation: "unavailable" }] as SessionLineageSnapshot[]
    const host = mount(() => createComponent(SessionLineageCenter, { sessions: () => sessions }))

    expect(host.querySelector('[role="tree"]')?.getAttribute("aria-label")).toBe("Session lineage")
    expect(host.textContent).toContain("Orphan session")
    expect(host.textContent).toContain("Unavailable")
  })

  test("keeps controlled lineage expansion in sync with the persisted layout owner", () => {
    const sessions = [
      { id: "parent", label: "Parent session", relation: "current" },
      { id: "child", parentId: "parent", label: "Child session", relation: "derived" },
    ] as SessionLineageSnapshot[]
    const [expanded, setExpanded] = createSignal<string[]>([])
    const host = mount(() => createComponent(SessionLineageCenter, {
      sessions: () => sessions,
      expanded,
      onExpandedChange: setExpanded,
    }))

    expect(host.textContent).not.toContain("Child session")
    ;(host.querySelector('[role="treeitem"] button') as HTMLButtonElement).click()

    expect(expanded()).toEqual(["parent"])
    expect(host.textContent).toContain("Child session")
  })

  test("renders unavailable metrics without inventing values", () => {
    const host = mount(() => createComponent(ContextIntelligence, { usage: () => undefined }))

    expect(host.textContent).toContain("Context intelligence")
    expect(host.textContent).toContain("Provider")
    expect(host.textContent).toContain("Unavailable")
    expect(host.textContent).not.toContain("%")
  })

  test("switches the context panel to real timeline activity", () => {
    const [tab, setTab] = createSignal<"usage" | "activity">("usage")
    const event = {
      id: "evt-activity",
      kind: "completion",
      timelineLabelKey: "autonomousWorkspace.timeline.event.session",
      timestamp: 1,
      state: "completed",
    } as AgentExecutionEvent
    const host = mount(() => createComponent(ContextIntelligence, {
      usage: () => undefined,
      events: () => [event],
      tab,
      onTabChange: setTab,
    }))

    expect(host.textContent).toContain("Provider")
    const activity = [...host.querySelectorAll("button")].find((button) => button.textContent === "Timeline") as HTMLButtonElement
    activity.click()

    expect(tab()).toBe("activity")
    expect(host.textContent).toContain("Session activity")
    expect(host.textContent).toContain("Events: 1")
  })

  test("renders unsupported binary changes without leaking patch content", () => {
    const changes = normalizeWorkspaceChanges([
      { file: "assets/private.bin", status: "modified", binary: true, patch: "secret binary payload" },
    ])
    const host = mount(() => createComponent(ChangesReviewCenter, { changes: () => changes }))

    expect(host.textContent).toContain("assets/private.bin")
    expect(host.textContent).toContain("Unsupported")
    expect(host.textContent).not.toContain("secret binary payload")
  })

  test("keeps the opt-in toggle interactive and routes change selection to the existing review path", () => {
    const [enabled, setEnabled] = createSignal(false)
    let selected = ""
    const toggleHost = mount(() => createComponent(WorkspaceModeToggle, { enabled, onToggle: () => setEnabled(true) }))

    const toggle = toggleHost.querySelector("button") as HTMLButtonElement
    toggle.click()
    expect(enabled()).toBe(true)
    const enabledHost = mount(() => createComponent(WorkspaceModeToggle, { enabled: () => true, onToggle: () => {} }))
    expect(enabledHost.textContent).toContain("Disable autonomous workspace")
    const changeHost = mount(() => createComponent(ChangesReviewCenter, {
      changes: () => normalizeWorkspaceChanges([{ file: "src/main.ts", status: "modified", additions: 1, deletions: 0 }]),
      onSelect: (change) => { selected = change.file },
    }))
    const change = [...changeHost.querySelectorAll("button")].find((button) => button.textContent?.includes("src/main.ts"))
    change?.click()
    expect(selected).toBe("src/main.ts")
  })

  test("shows review loading instead of an empty state while authoritative diffs load", () => {
    const host = mount(() => createComponent(ChangesReviewCenter, { changes: () => [], loading: () => true }))
    expect(host.textContent).toContain("Loading changes...")
    expect(host.textContent).not.toContain("No changes available.")
  })
})
