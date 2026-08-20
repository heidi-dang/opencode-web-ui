import type { ServerEvent } from "@/context/server-sdk"
import type { ConnectionSnapshot } from "@/utils/connection-manager"
import type { AgentExecutionEvent } from "./contracts"
import { createSessionWorkspaceController, type SessionWorkspaceScope } from "./runtime-bridge"

type RuntimeEvent = { name: string; details: ServerEvent }

export type SessionWorkspaceRuntimeSource = {
  scope: string
  event: {
    listen: (listener: (event: RuntimeEvent) => void) => () => void
  }
  connection: {
    onChange: (listener: (snapshot: ConnectionSnapshot) => void) => () => void
  }
}

export function createSessionWorkspaceLifecycle(input: {
  source: SessionWorkspaceRuntimeSource
  scope: SessionWorkspaceScope
  onChange?: (timeline: AgentExecutionEvent[]) => void
}) {
  const controller = createSessionWorkspaceController(input.scope)
  const stopTimeline = input.onChange ? controller.subscribe(() => input.onChange?.(controller.timeline())) : () => {}
  const stopEvents = input.source.event.listen((event) => {
    if (event.name !== input.scope.directory) return
    controller.accept({ ...input.scope, event: event.details })
  })
  const stopConnection = input.source.connection.onChange((snapshot) => {
    if (snapshot.state !== "STATE_RESYNCING") return
    controller.reset()
  })
  let disposed = false

  return {
    scope: (): SessionWorkspaceScope => input.scope,
    timeline: controller.timeline,
    dispose() {
      if (disposed) return
      disposed = true
      stopEvents()
      stopConnection()
      stopTimeline()
      controller.dispose()
    },
  }
}
