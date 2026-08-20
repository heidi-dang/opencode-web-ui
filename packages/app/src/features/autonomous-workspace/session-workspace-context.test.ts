import { describe, expect, test } from "bun:test"
import type { ServerEvent } from "@/context/server-sdk"
import type { ConnectionSnapshot } from "@/utils/connection-manager"
import {
  createSessionWorkspaceLifecycle,
  type SessionWorkspaceRuntimeSource,
} from "./session-workspace-lifecycle"

type EventOf<Type extends ServerEvent["type"]> = Extract<ServerEvent, { type: Type }>
type RuntimeEvent = { name: string; details: ServerEvent }

function idle(id: string, sessionID: string): EventOf<"session.idle"> {
  return {
    id,
    type: "session.idle",
    properties: { sessionID },
  }
}

function createRuntimeSource(serverID: string) {
  const eventListeners = new Set<(event: RuntimeEvent) => void>()
  const connectionListeners = new Set<(snapshot: ConnectionSnapshot) => void>()
  let eventUnsubscribes = 0
  let connectionUnsubscribes = 0

  const source: SessionWorkspaceRuntimeSource = {
    scope: serverID,
    event: {
      listen(listener) {
        eventListeners.add(listener)
        return () => {
          if (!eventListeners.delete(listener)) return
          eventUnsubscribes++
        }
      },
    },
    connection: {
      onChange(listener) {
        connectionListeners.add(listener)
        return () => {
          if (!connectionListeners.delete(listener)) return
          connectionUnsubscribes++
        }
      },
    },
  }

  return {
    source,
    emit(directory: string, event: ServerEvent) {
      for (const listener of eventListeners) listener({ name: directory, details: event })
    },
    transition(state: ConnectionSnapshot["state"]) {
      const snapshot: ConnectionSnapshot = {
        state,
        failures: 0,
        changedAt: 1,
        circuit: "CLOSED",
      }
      for (const listener of connectionListeners) listener(snapshot)
    },
    listenerCounts() {
      return { events: eventListeners.size, connections: connectionListeners.size }
    },
    unsubscribeCounts() {
      return { events: eventUnsubscribes, connections: connectionUnsubscribes }
    },
  }
}

describe("session workspace lifecycle owner", () => {
  test("scopes normalized events, replaces subscriptions on session change, and clears replay on resync", () => {
    const runtime = createRuntimeSource("srv-a")
    const first = createSessionWorkspaceLifecycle({
      source: runtime.source,
      scope: { serverID: "srv-a", directory: "/repo-a", sessionID: "ses-a" },
    })

    expect(runtime.listenerCounts()).toEqual({ events: 1, connections: 1 })

    runtime.emit("/repo-b", idle("evt-directory", "ses-a"))
    runtime.emit("/repo-a", idle("evt-session", "ses-b"))
    runtime.emit("/repo-a", idle("evt-a", "ses-a"))
    expect(first.timeline().map((event) => event.id)).toEqual(["evt-a"])

    first.dispose()
    const second = createSessionWorkspaceLifecycle({
      source: runtime.source,
      scope: { serverID: "srv-a", directory: "/repo-a", sessionID: "ses-b" },
    })
    expect(first.timeline()).toEqual([])
    expect(second.scope()).toEqual({ serverID: "srv-a", directory: "/repo-a", sessionID: "ses-b" })
    expect(runtime.listenerCounts()).toEqual({ events: 1, connections: 1 })
    expect(runtime.unsubscribeCounts()).toEqual({ events: 1, connections: 1 })

    runtime.emit("/repo-a", idle("evt-stale", "ses-a"))
    runtime.emit("/repo-a", idle("evt-b", "ses-b"))
    expect(second.timeline().map((event) => event.id)).toEqual(["evt-b"])

    runtime.transition("STATE_RESYNCING")
    expect(second.timeline()).toEqual([])
    runtime.emit("/repo-a", idle("evt-b", "ses-b"))
    expect(second.timeline().map((event) => event.id)).toEqual(["evt-b"])

    second.dispose()
    expect(runtime.listenerCounts()).toEqual({ events: 0, connections: 0 })
    expect(runtime.unsubscribeCounts()).toEqual({ events: 2, connections: 2 })

    runtime.emit("/repo-a", idle("evt-after-dispose", "ses-b"))
    expect(second.timeline()).toEqual([])
  })
})
