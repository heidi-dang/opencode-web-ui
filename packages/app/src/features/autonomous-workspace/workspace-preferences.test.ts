import { beforeEach, describe, expect, test } from "bun:test"
import {
  defaultWorkspacePreference,
  loadWorkspacePreference,
  saveWorkspacePreference,
  workspacePreferenceKey,
  type WorkspacePreference,
} from "./workspace-preferences"

const scope = { serverID: "srv-a", directory: "/workspace/project" }

beforeEach(() => {
  localStorage.clear()
})

describe("autonomous workspace preferences", () => {
  test("uses a stable key scoped by server ID and directory", () => {
    expect(workspacePreferenceKey(scope)).toBe(workspacePreferenceKey(scope))
    expect(workspacePreferenceKey(scope)).not.toBe(workspacePreferenceKey({ ...scope, serverID: "srv-b" }))
    expect(workspacePreferenceKey(scope)).not.toBe(workspacePreferenceKey({ ...scope, directory: "/workspace/other" }))
    expect(workspacePreferenceKey(scope)).toContain("autonomous-workspace")
    expect(workspacePreferenceKey(scope)).not.toContain("/")
  })

  test("falls back to the safe opt-in default when nothing is persisted", () => {
    expect(loadWorkspacePreference(scope)).toEqual(defaultWorkspacePreference)
  })

  test("round-trips only the versioned preference schema", () => {
    const preference: WorkspacePreference = {
      version: 1,
      enabled: true,
      view: "timeline",
      expanded: ["timeline", "changes"],
      contextTab: "usage",
    }

    expect(saveWorkspacePreference(scope, preference)).toBeTrue()
    expect(loadWorkspacePreference(scope)).toEqual(preference)
  })

  test.each([
    "not-json",
    JSON.stringify({ version: 2, enabled: true, view: "timeline", expanded: [] }),
    JSON.stringify({ version: 1, enabled: "yes", view: "timeline", expanded: [] }),
    JSON.stringify({ version: 1, enabled: true, view: "unknown", expanded: [] }),
    JSON.stringify({ version: 1, enabled: true, view: "timeline", expanded: ["unknown"] }),
    JSON.stringify({ version: 1, enabled: true, view: "timeline", expanded: ["timeline", "timeline"] }),
    JSON.stringify({ version: 1, enabled: true, view: "timeline", expanded: [], contextTab: "unknown" }),
  ])("falls back for invalid persisted schema: %s", (raw) => {
    localStorage.setItem(workspacePreferenceKey(scope), raw)
    expect(loadWorkspacePreference(scope)).toEqual(defaultWorkspacePreference)
  })

  test("does not restore runtime truth or secret-like fields", () => {
    localStorage.setItem(
      workspacePreferenceKey(scope),
      JSON.stringify({
        version: 1,
        enabled: true,
        view: "timeline",
        expanded: [],
        sessionID: "ses-secret",
        events: [{ id: "event-secret" }],
        token: "credential-secret",
      }),
    )

    expect(loadWorkspacePreference(scope)).toEqual(defaultWorkspacePreference)

    saveWorkspacePreference(scope, {
      version: 1,
      enabled: true,
      view: "conversation",
      expanded: [],
      // Runtime callers are typed, but persistence must remain safe at runtime too.
      sessionID: "ses-secret",
      events: [{ id: "event-secret" }],
      token: "credential-secret",
    } as WorkspacePreference & Record<string, unknown>)

    const stored = localStorage.getItem(workspacePreferenceKey(scope))!
    expect(stored).not.toContain("ses-secret")
    expect(stored).not.toContain("event-secret")
    expect(stored).not.toContain("credential-secret")
    expect(loadWorkspacePreference(scope)).toEqual({
      ...defaultWorkspacePreference,
      enabled: true,
    })
  })

  test("storage failures are non-fatal and do not fabricate a preference", () => {
    const failingStorage = {
      getItem() {
        throw new Error("read failed")
      },
      setItem() {
        throw new Error("write failed")
      },
    } as unknown as Storage

    expect(loadWorkspacePreference(scope, failingStorage)).toEqual(defaultWorkspacePreference)
    expect(saveWorkspacePreference(scope, defaultWorkspacePreference, failingStorage)).toBeFalse()
  })
})
