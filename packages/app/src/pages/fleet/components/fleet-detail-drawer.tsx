import { type FleetServerSnapshot } from "../fleet-types"
import { formatRelativeTime, formatVersion, formatDuration } from "../fleet-format"
import { FleetStatusBadge } from "./fleet-status-badge"

interface DetailDrawerProps {
  server: FleetServerSnapshot | null
  onClose: () => void
  onRefresh: (key: string) => void
  onReconnect: (key: string) => void
}

function SectionHeading(props: { title: string }) {
  return <h4 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{props.title}</h4>
}

export function FleetDetailDrawer(props: DetailDrawerProps) {
  const s = () => props.server
  if (!s()) return null

  return (
    <div class="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l bg-background shadow-xl flex flex-col">
      {/* Header */}
      <div class="flex items-center justify-between border-b px-4 py-3">
        <div class="flex items-center gap-2 min-w-0">
          <span class="truncate text-sm font-semibold">{s()!.name}</span>
          <FleetStatusBadge state={s()!.health.state} latencyMs={s()!.health.latencyMs} />
        </div>
        <button
          class="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent"
          onClick={props.onClose}
          title="Close"
        >
          ✕
        </button>
      </div>

      {/* Scrollable body */}
      <div class="flex-1 overflow-y-auto p-4 space-y-5 text-sm">

        {/* Section 1: Overview */}
        <section>
          <SectionHeading title="Overview" />
          <table class="w-full text-xs">
            <tbody>
              <tr><td class="py-0.5 pr-3 text-muted-foreground w-28">URL</td><td class="font-mono truncate max-w-[260px]">{s()!.url}</td></tr>
              {s()!.label && <tr><td class="py-0.5 pr-3 text-muted-foreground">Label</td><td>{s()!.label}</td></tr>}
              <tr><td class="py-0.5 pr-3 text-muted-foreground">Connection</td><td>{s()!.connection.type.toUpperCase()}</td></tr>
              <tr><td class="py-0.5 pr-3 text-muted-foreground">Version</td><td>{formatVersion(s()!.health.version)}</td></tr>
              <tr><td class="py-0.5 pr-3 text-muted-foreground">Latency</td><td>{s()!.health.latencyMs !== undefined ? `~${s()!.health.latencyMs}ms` : "—"}</td></tr>
              <tr><td class="py-0.5 pr-3 text-muted-foreground">Last check</td><td>{formatRelativeTime(s()!.health.checkedAt)}</td></tr>
            </tbody>
          </table>
        </section>

        {/* Section 2: Projects */}
        <section>
          <SectionHeading title="Projects" />
          <div class="text-xs text-muted-foreground">
            {s()!.projects.open} open · {s()!.projects.known} known on server
          </div>
        </section>

        {/* Section 3: Sessions */}
        <section>
          <SectionHeading title="Sessions" />
          <div class="space-y-1 text-xs">
            <div class="flex justify-between"><span>Running</span><span class="font-mono">{s()!.sessions.running}</span></div>
            <div class="flex justify-between"><span>Busy</span><span class="font-mono">{s()!.sessions.busy}</span></div>
            {s()!.sessions.permissionBlocked > 0 && (
              <div class="flex justify-between text-amber-500"><span>Permission blocked</span><span class="font-mono">{s()!.sessions.permissionBlocked}</span></div>
            )}
            {s()!.sessions.questionBlocked > 0 && (
              <div class="flex justify-between text-amber-500"><span>Question blocked</span><span class="font-mono">{s()!.sessions.questionBlocked}</span></div>
            )}
            <div class="flex justify-between font-medium border-t pt-1 mt-1"><span>Total active</span><span class="font-mono">{s()!.sessions.totalActive}</span></div>
          </div>
        </section>

        {/* Section 4: Providers */}
        <section>
          <SectionHeading title="Providers" />
          <div class="text-xs text-muted-foreground">
            {s()!.providers.connected} connected · {s()!.providers.configured} configured
          </div>
        </section>

        {/* Section 5: Diagnostics / stream state */}
        <section>
          <SectionHeading title="Diagnostics" />
          <table class="w-full text-xs">
            <tbody>
              <tr><td class="py-0.5 pr-3 text-muted-foreground w-28">Stream state</td><td class={s()!.stream.state === "connected" ? "text-green-500" : "text-amber-500"}>{s()!.stream.state}</td></tr>
              <tr><td class="py-0.5 pr-3 text-muted-foreground">Connected at</td><td>{s()!.stream.connectedAt != null ? new Date(s()!.stream.connectedAt).toLocaleString() : "—"}</td></tr>
              <tr><td class="py-0.5 pr-3 text-muted-foreground">Last event</td><td>{formatRelativeTime(s()!.stream.lastEventAt)}</td></tr>
              <tr><td class="py-0.5 pr-3 text-muted-foreground">Reconnects</td><td>{s()!.stream.reconnectCount}</td></tr>
            </tbody>
          </table>

          <div class="flex items-center gap-2 mt-3">
            <button
              class="inline-flex items-center justify-center rounded px-2 py-1 text-xs font-medium bg-accent hover:bg-accent/80"
              onClick={() => props.onRefresh(s()!.key)}
            >
              Refresh Health
            </button>
            <button
              class="inline-flex items-center justify-center rounded px-2 py-1 text-xs font-medium bg-accent hover:bg-accent/80"
              onClick={() => props.onReconnect(s()!.key)}
            >
              Reconnect Stream
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
