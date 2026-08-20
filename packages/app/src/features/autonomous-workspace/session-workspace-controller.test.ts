import { describe, expect, test } from "bun:test"
import { createSessionWorkspaceController, type SessionWorkspaceScope } from "./runtime-bridge"

const scope = (serverID = "srv-a", directory = "/repo", sessionID = "ses-a"): SessionWorkspaceScope => ({
  serverID,
  directory,
  sessionID,
})

const event = (id: string, type: string, properties: Record<string, unknown>) =>
  ({ id, type, properties }) as never

describe("session workspace controller", () => {
  test("keeps two official events with the same type and session distinct by event id", () => {
    const controller = createSessionWorkspaceController(scope())

    controller.accept(event("evt-1", "session.next.tool.called", { sessionID: "ses-a", callID: "tool-1" }))
    controller.accept(event("evt-2", "session.next.tool.called", { sessionID: "ses-a", callID: "tool-2" }))

    expect(controller.timeline()).toHaveLength(2)
    expect(controller.timeline().map((item) => item.id)).toEqual(["evt-1", "evt-2"])
  })

  test("does not notify twice for an event replay with the same official id", () => {
    const controller = createSessionWorkspaceController(scope())
    let notifications = 0
    controller.subscribe(() => notifications++)

    controller.accept(event("evt-1", "session.idle", { sessionID: "ses-a" }))
    controller.accept(event("evt-1", "session.idle", { sessionID: "ses-a" }))

    expect(notifications).toBe(1)
    expect(controller.timeline()).toHaveLength(1)
  })
})
