import { describe, expect, test } from "bun:test"
import type { ServerEvent } from "@/context/server-sdk"
import {
  createSessionWorkspaceController,
  type IdlessServerEvent,
  type SessionWorkspaceEventInput,
  type SessionWorkspaceScope,
} from "./runtime-bridge"

type EventOf<Type extends ServerEvent["type"]> = Extract<ServerEvent, { type: Type }>
type IdlessEventOf<Type extends ServerEvent["type"]> = Extract<IdlessServerEvent, { type: Type }>

const scope = (serverID = "srv-a", directory = "/repo", sessionID = "ses-a"): SessionWorkspaceScope => ({
  serverID,
  directory,
  sessionID,
})

const input = (event: ServerEvent | IdlessServerEvent, source = scope()): SessionWorkspaceEventInput => ({
  ...source,
  event,
})

const idle = (id: string, sessionID = "ses-a"): EventOf<"session.idle"> => ({
  id,
  type: "session.idle",
  properties: { sessionID },
})

const toolCalled = (
  id: string,
  callID: string,
  timestamp: number,
  sessionID = "ses-a",
): EventOf<"session.next.tool.called"> => ({
  id,
  type: "session.next.tool.called",
  properties: {
    timestamp,
    sessionID,
    assistantMessageID: "msg-a",
    callID,
    tool: "read",
    input: { prompt: "must not be retained" },
    provider: { executed: true },
  },
})

const idlessToolCalled = (
  callID: string,
  timestamp: number,
  sessionID = "ses-a",
): IdlessEventOf<"session.next.tool.called"> => ({
  type: "session.next.tool.called",
  properties: {
    timestamp,
    sessionID,
    assistantMessageID: "msg-a",
    callID,
    tool: "read",
    input: { prompt: "must not be retained" },
    provider: { executed: true },
  },
})

const idlessIdle = (sessionID = "ses-a"): IdlessEventOf<"session.idle"> => ({
  type: "session.idle",
  properties: { sessionID },
})

const sessionlessIdle = () => ({
  id: "evt-sessionless",
  type: "session.idle",
  properties: {},
} satisfies { id: string; type: "session.idle"; properties: Record<string, unknown> })

const idlessPermissionAsked = (requestID: string, sessionID = "ses-a"): IdlessEventOf<"permission.asked"> => ({
  type: "permission.asked",
  properties: {
    id: requestID,
    sessionID,
    permission: "edit",
    patterns: [],
    metadata: {},
    always: [],
  },
})

describe("session workspace controller", () => {
  test("keeps two official events with the same type and session distinct by event id", () => {
    const controller = createSessionWorkspaceController(scope())

    controller.accept(input(toolCalled("evt-1", "tool-1", 10)))
    controller.accept(input(toolCalled("evt-2", "tool-2", 11)))

    expect(controller.timeline()).toHaveLength(2)
    expect(controller.timeline().map((item) => item.id)).toEqual(["evt-1", "evt-2"])
  })

  test("does not notify twice for an event replay with the same official id", () => {
    const controller = createSessionWorkspaceController(scope())
    let notifications = 0
    controller.subscribe(() => notifications++)

    controller.accept(input(idle("evt-1")))
    controller.accept(input(idle("evt-1")))

    expect(notifications).toBe(1)
    expect(controller.timeline()).toHaveLength(1)
  })

  test("requires complete source scope and rejects sessionless events", () => {
    const controller = createSessionWorkspaceController(scope())
    const incomplete = { serverID: "srv-a", sessionID: "ses-a", event: idle("evt-incomplete") }

    // @ts-expect-error directory is required at the controller boundary
    expect(controller.accept(incomplete)).toBe(false)
    const malformed = { ...scope(), event: sessionlessIdle() }
    // @ts-expect-error malformed runtime payload omits the official sessionID
    expect(controller.accept(malformed)).toBe(false)
    expect(controller.timeline()).toEqual([])
  })

  test("isolates server, directory, and session scopes", () => {
    const controller = createSessionWorkspaceController(scope())

    expect(controller.accept(input(idle("evt-server"), scope("srv-b")))).toBe(false)
    expect(controller.accept(input(idle("evt-directory"), scope("srv-a", "/other")))).toBe(false)
    expect(controller.accept(input(idle("evt-session", "ses-b"), scope("srv-a", "/repo", "ses-b")))).toBe(false)
    expect(controller.timeline()).toEqual([])
  })

  test("deduplicates a deterministic id-less replay while keeping distinct domain events", () => {
    const controller = createSessionWorkspaceController(scope())
    let notifications = 0
    controller.subscribe(() => notifications++)

    expect(controller.accept(input(idlessToolCalled("tool-a", 10)))).toBe(true)
    expect(controller.accept(input(idlessToolCalled("tool-a", 10)))).toBe(false)
    expect(controller.accept(input(idlessToolCalled("tool-b", 10)))).toBe(true)

    expect(notifications).toBe(2)
    expect(controller.timeline()).toHaveLength(2)
  })

  test("ignores an id-less event without a stable domain identity", () => {
    const controller = createSessionWorkspaceController(scope())

    expect(controller.accept(input(idlessIdle()))).toBe(false)
    expect(controller.timeline()).toEqual([])
  })

  test("uses an authoritative permission request id without requiring a timestamp", () => {
    const controller = createSessionWorkspaceController(scope())
    let notifications = 0
    controller.subscribe(() => notifications++)

    expect(controller.accept(input(idlessPermissionAsked("perm-a")))).toBe(true)
    expect(controller.accept(input(idlessPermissionAsked("perm-a")))).toBe(false)

    expect(notifications).toBe(1)
    expect(controller.timeline()).toHaveLength(1)
  })

  test("orders events by timestamp then official identity and retains the later tied entry", () => {
    const controller = createSessionWorkspaceController(scope(), { limit: 2 })

    controller.accept(input(toolCalled("evt-b", "tool-b", 10)))
    controller.accept(input(toolCalled("evt-a", "tool-a", 10)))
    controller.accept(input(toolCalled("evt-c", "tool-c", 11)))

    expect(controller.timeline().map((item) => item.id)).toEqual(["evt-b", "evt-c"])
  })

  test("orders delayed events without letting a stale replay replace the original timeline item", () => {
    const controller = createSessionWorkspaceController(scope())

    controller.accept(input(toolCalled("evt-new", "tool-new", 20)))
    controller.accept(input(toolCalled("evt-old", "tool-old", 10)))
    controller.accept(input(toolCalled("evt-new", "tool-new", 5)))

    expect(controller.timeline().map((item) => item.id)).toEqual(["evt-old", "evt-new"])
    expect(controller.timeline().find((item) => item.id === "evt-new")?.timestamp).toBe(20)
  })

  test("suppresses replay after visible eviction without notifying", () => {
    const controller = createSessionWorkspaceController(scope(), { limit: 1, replayLimit: 2 })
    let notifications = 0
    controller.subscribe(() => notifications++)

    expect(controller.accept(input(toolCalled("evt-1", "tool-1", 10)))).toBe(true)
    expect(controller.accept(input(toolCalled("evt-2", "tool-2", 11)))).toBe(true)
    expect(controller.accept(input(toolCalled("evt-1", "tool-1", 10)))).toBe(false)

    expect(notifications).toBe(2)
    expect(controller.timeline().map((item) => item.id)).toEqual(["evt-2"])
  })

  test("does not notify when an out-of-retention event leaves the visible timeline unchanged", () => {
    const controller = createSessionWorkspaceController(scope(), { limit: 2 })
    let notifications = 0
    controller.subscribe(() => notifications++)

    controller.accept(input(toolCalled("evt-1", "tool-1", 10)))
    controller.accept(input(toolCalled("evt-2", "tool-2", 20)))
    expect(controller.accept(input(toolCalled("evt-0", "tool-0", 5)))).toBe(false)

    expect(notifications).toBe(2)
    expect(controller.timeline().map((item) => item.id)).toEqual(["evt-1", "evt-2"])
  })

  test("keeps safe metadata only and ignores raw prompt and delta events", () => {
    const controller = createSessionWorkspaceController(scope())

    expect(controller.accept(input(toolCalled("evt-tool", "tool-a", 10)))).toBe(true)
    expect(
      controller.accept(
        input({
          id: "evt-prompt",
          type: "session.next.prompted",
          properties: {
            timestamp: 11,
            sessionID: "ses-a",
            messageID: "msg-a",
            prompt: { text: "must not be retained" },
            delivery: "steer",
          },
        } satisfies EventOf<"session.next.prompted">),
      ),
    ).toBe(false)

    const [timelineEvent] = controller.timeline()
    expect(timelineEvent).toMatchObject({ id: "evt-tool", label: "session.next.tool.called" })
    expect(timelineEvent).not.toHaveProperty("detail")
    expect(timelineEvent).not.toHaveProperty("output")
  })

  test("stops accepting and notifying after disposal", () => {
    const controller = createSessionWorkspaceController(scope())
    let notifications = 0
    controller.subscribe(() => notifications++)
    controller.dispose()

    expect(controller.accept(input(idle("evt-1")))).toBe(false)
    expect(notifications).toBe(0)
    expect(controller.timeline()).toEqual([])
  })
})
