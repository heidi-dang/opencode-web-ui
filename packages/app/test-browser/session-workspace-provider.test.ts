import { describe, expect, test } from "bun:test"
import type { ServerEvent } from "@/context/server-sdk"
import type { ConnectionSnapshot } from "@/utils/connection-manager"
import type { AgentExecutionEvent } from "@/features/autonomous-workspace/contracts"
import { createReactiveSessionWorkspaceOwner } from "@/features/autonomous-workspace/session-workspace-context"
import type { SessionWorkspaceRuntimeSource } from "@/features/autonomous-workspace/session-workspace-lifecycle"
import type { SessionWorkspaceScope } from "@/features/autonomous-workspace/runtime-bridge"
import { createRoot, createSignal, type Accessor } from "solid-js"

type RuntimeEvent = { name: string; details: ServerEvent }
type WorkspaceOwner = {
  scope: Accessor<SessionWorkspaceScope>
  timeline: Accessor<AgentExecutionEvent[]>
}

function idle(id: string, sessionID: string): Extract<ServerEvent, { type: "session.idle" }> {
  return { id, type: "session.idle", properties: { sessionID } }
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
          if (eventListeners.delete(listener)) eventUnsubscribes++
        }
      },
    },
    connection: {
      onChange(listener) {
        connectionListeners.add(listener)
        return () => {
          if (connectionListeners.delete(listener)) connectionUnsubscribes++
        }
      },
    },
  }

  return {
    source,
    emit(directory: string, event: ServerEvent) {
      for (const listener of eventListeners) listener({ name: directory, details: event })
    },
    counts() {
      return {
        events: eventListeners.size,
        connections: connectionListeners.size,
        eventUnsubscribes,
        connectionUnsubscribes,
      }
    },
  }
}

describe("reactive session workspace owner", () => {
  test("replaces scoped listeners exactly once and disposes the final lifecycle", async () => {
    const serverA = createRuntimeSource("srv-a")
    const serverB = createRuntimeSource("srv-b")
    const [source, setSource] = createSignal<SessionWorkspaceRuntimeSource>(serverA.source)
    const [directory, setDirectory] = createSignal("/repo-a")
    const [sessionID, setSessionID] = createSignal("ses-a")
    let owner: WorkspaceOwner | undefined
    const dispose = createRoot((dispose) => {
      owner = createReactiveSessionWorkspaceOwner({ source, directory, sessionID })
      return dispose
    })
    await Promise.resolve()

    expect(serverA.counts()).toEqual({ events: 1, connections: 1, eventUnsubscribes: 0, connectionUnsubscribes: 0 })
    serverA.emit("/repo-a", idle("evt-a", "ses-a"))
    expect(owner?.timeline().map((event) => event.id)).toEqual(["evt-a"])

    setSessionID("ses-b")
    await Promise.resolve()
    expect(serverA.counts()).toEqual({ events: 1, connections: 1, eventUnsubscribes: 1, connectionUnsubscribes: 1 })
    expect(owner?.timeline()).toEqual([])
    serverA.emit("/repo-a", idle("evt-stale-session", "ses-a"))
    expect(owner?.timeline()).toEqual([])

    setDirectory("/repo-b")
    await Promise.resolve()
    expect(serverA.counts()).toEqual({ events: 1, connections: 1, eventUnsubscribes: 2, connectionUnsubscribes: 2 })
    expect(owner?.timeline()).toEqual([])
    serverA.emit("/repo-a", idle("evt-stale-directory", "ses-b"))
    expect(owner?.timeline()).toEqual([])

    setSource(serverB.source)
    await Promise.resolve()
    expect(serverA.counts()).toEqual({ events: 0, connections: 0, eventUnsubscribes: 3, connectionUnsubscribes: 3 })
    expect(serverB.counts()).toEqual({ events: 1, connections: 1, eventUnsubscribes: 0, connectionUnsubscribes: 0 })
    expect(owner?.scope()).toEqual({ serverID: "srv-b", directory: "/repo-b", sessionID: "ses-b" })
    expect(owner?.timeline()).toEqual([])
    serverA.emit("/repo-b", idle("evt-stale-server", "ses-b"))
    expect(owner?.timeline()).toEqual([])
    serverB.emit("/repo-b", idle("evt-b", "ses-b"))
    expect(owner?.timeline().map((event) => event.id)).toEqual(["evt-b"])

    dispose()
    expect(serverA.counts()).toEqual({ events: 0, connections: 0, eventUnsubscribes: 3, connectionUnsubscribes: 3 })
    expect(serverB.counts()).toEqual({ events: 0, connections: 0, eventUnsubscribes: 1, connectionUnsubscribes: 1 })
  })
})
