import type { ConnectionState } from "@/utils/connection-manager"

export type ServerStatusView = {
  visible: boolean
  state: "hidden" | "connecting" | "connected" | "syncing" | "reconnecting" | "degraded" | "offline"
  label: string
}

export function resolveServerStatusView(input: {
  visible: boolean
  connection: ConnectionState | undefined
  healthy: boolean | undefined
}): ServerStatusView {
  if (!input.visible) return { visible: false, state: "hidden", label: "" }
  if (input.connection === "RECONNECTING") return { visible: true, state: "reconnecting", label: "Reconnecting" }
  if (input.connection === "DEGRADED") return { visible: true, state: "degraded", label: "Degraded" }
  if (input.connection === "STATE_RESYNCING") return { visible: true, state: "syncing", label: "Syncing" }
  if (input.connection === "UNHEALTHY" || input.healthy === false) {
    return { visible: true, state: "offline", label: "Offline" }
  }
  if (input.connection === "CONNECTING") return { visible: true, state: "connecting", label: "Connecting" }
  if (input.connection === "READY" && input.healthy === true)
    return { visible: true, state: "connected", label: "Connected" }
  if (input.healthy === true) return { visible: true, state: "connected", label: "Connected" }
  return { visible: true, state: "connecting", label: "Connecting" }
}
