import { type FleetServerSnapshot } from "../fleet-types"
import { FleetStatusBadge } from "./fleet-status-badge"
import { formatRelativeTime } from "../fleet-format"

interface ServerCardProps {
  server: FleetServerSnapshot
  onRefresh: (key: string) => void
  onOpen: (key: string) => void
  onEdit: (key: string) => void
  onReconnect: (key: string) => void
  refreshing: boolean
}

export function FleetServerCard(props: ServerCardProps) {
  const s = () => props.server
  const connTypeLabel = () => {
    const t = s().connection.type
    return t === "wsl" ? "WSL" : t === "ssh" ? "SSH" : t === "sidecar" ? "Sidecar" : "HTTP"
  }
  const hasStreamIssue = () =>
    s().stream.state === "reconnecting" || s().stream.state === "disconnected"

  return (
    <div
      class="relative flex flex-col gap-1 rounded-lg border bg-card p-3 text-card-foreground shadow-xs transition hover:shadow-md"
      data-server-key={s().key}
      data-server-state={s().health.state}
    >
      {/* Row 1: name + status */}
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <span class="truncate text-sm font-medium">{s().name}</span>
          {s().label && s().label !== s().name ? (
            <span class="hidden sm:inline text-xs text-muted-foreground truncate">{s().label}</span>
          ) : null}
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <FleetStatusBadge state={s().health.state} latencyMs={s().health.latencyMs} />
        </div>
      </div>

      {/* Row 2: meta */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{connTypeLabel()}</span>
        {s().health.version ? <span>v{s().health.version}</span> : null}
        {s().health.checkedAt ? <span>Checked {formatRelativeTime(s().health.checkedAt)}</span> : null}
        {hasStreamIssue() ? (
          <span class="text-amber-500 font-medium">
            Stream: {s().stream.state}
            {s().stream.reconnectCount > 0 ? ` (${s().stream.reconnectCount})` : ""}
          </span>
        ) : (
          <span class="text-green-500">
            Stream: {s().stream.state}
          </span>
        )}
      </div>

      {/* Row 3: metrics */}
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span title="Running sessions">
          <span class="font-mono">{s().sessions.running}</span> sessions
        </span>
        {s().sessions.permissionBlocked > 0 || s().sessions.questionBlocked > 0 ? (
          <span class="text-amber-500" title="Blocked sessions">
            <span class="font-mono">{s().sessions.permissionBlocked + s().sessions.questionBlocked}</span> blocked
          </span>
        ) : null}
        <span title="Open projects">
          <span class="font-mono">{s().projects.open}/{s().projects.known}</span> projects
        </span>
        <span title="Connected providers">
          <span class="font-mono">{s().providers.connected}/{s().providers.configured}</span> providers
        </span>
      </div>

      {/* Row 4: actions */}
      <div class="flex items-center gap-1 pt-1 border-t border-border mt-1">
        <button
          class="inline-flex items-center justify-center rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
          disabled={props.refreshing}
          onClick={() => props.onRefresh(s().key)}
          title="Refresh health"
        >
          Refresh
        </button>
        <button
          class="inline-flex items-center justify-center rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => props.onOpen(s().key)}
          title="Open server"
        >
          Open
        </button>
        <button
          class="inline-flex items-center justify-center rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => props.onReconnect(s().key)}
          title="Reconnect event stream"
        >
          Reconnect
        </button>
        <button
          class="inline-flex items-center justify-center rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => props.onEdit(s().key)}
          title="Edit connection"
        >
          Edit
        </button>
      </div>
    </div>
  )
}
