import { useServerSDK } from "@/context/server-sdk"
import { createSimpleContext } from "@opencode-ai/ui/context"
import { type Accessor, createEffect, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import type { AgentExecutionEvent } from "./contracts"
import { createSessionWorkspaceLifecycle } from "./session-workspace-lifecycle"
import type { SessionWorkspaceScope } from "./runtime-bridge"

type SessionWorkspaceState = {
  scope: SessionWorkspaceScope
  timeline: AgentExecutionEvent[]
}

export const { use: useSessionWorkspace, provider: SessionWorkspaceProvider } = createSimpleContext({
  name: "SessionWorkspace",
  init: (props: { directory: Accessor<string>; sessionID: Accessor<string> }) => {
    const serverSDK = useServerSDK()
    const initial: SessionWorkspaceScope = {
      serverID: serverSDK().scope,
      directory: props.directory(),
      sessionID: props.sessionID(),
    }
    const [state, setState] = createStore<SessionWorkspaceState>({ scope: initial, timeline: [] })

    createEffect(() => {
      const source = serverSDK()
      const scope: SessionWorkspaceScope = {
        serverID: source.scope,
        directory: props.directory(),
        sessionID: props.sessionID(),
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
  },
})
