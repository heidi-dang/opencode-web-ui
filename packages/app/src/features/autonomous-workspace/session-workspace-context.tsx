import { type Accessor, createEffect, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { AgentExecutionEvent } from "./contracts"
import { createSessionWorkspaceLifecycle, type SessionWorkspaceRuntimeSource } from "./session-workspace-lifecycle"
import type { SessionWorkspaceScope } from "./runtime-bridge"

type SessionWorkspaceState = {
  scope: SessionWorkspaceScope
  timeline: AgentExecutionEvent[]
}

export function createReactiveSessionWorkspaceOwner(input: {
  source: Accessor<SessionWorkspaceRuntimeSource>
  directory: Accessor<string>
  sessionID: Accessor<string>
}) {
  const initialSource = input.source()
  const initial: SessionWorkspaceScope = {
    serverID: initialSource.scope,
    directory: input.directory(),
    sessionID: input.sessionID(),
  }
  const [state, setState] = createStore<SessionWorkspaceState>({ scope: initial, timeline: [] })

  createEffect(() => {
    const source = input.source()
    const scope: SessionWorkspaceScope = {
      serverID: source.scope,
      directory: input.directory(),
      sessionID: input.sessionID(),
    }
    const lifecycle = createSessionWorkspaceLifecycle({
      source,
      scope,
      onChange: (timeline) => setState("timeline", reconcile(timeline)),
    })
    setState("scope", reconcile(scope))
    setState("timeline", reconcile(lifecycle.timeline()))
    onCleanup(lifecycle.dispose)
  })

  return {
    scope: () => state.scope,
    timeline: () => state.timeline,
  }
}
