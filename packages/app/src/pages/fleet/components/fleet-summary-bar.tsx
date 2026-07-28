import { batch } from "solid-js"

interface SummaryBarProps {
  online: number
  degraded: number
  offline: number
  totalSessions: number
  totalBlocked: number
  totalServers: number
  refreshing: boolean
  onRefreshAll: () => void
}

export function FleetSummaryBar(props: SummaryBarProps) {
  return (
    <div class="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          <span class="font-semibold text-green-600 dark:text-green-400">{props.online}</span>{" "}
          <span class="text-muted-foreground">online</span>
        </span>
        {props.degraded > 0 && (
          <span>
            <span class="font-semibold text-amber-600 dark:text-amber-400">{props.degraded}</span>{" "}
            <span class="text-muted-foreground">degraded</span>
          </span>
        )}
        <span>
          <span class="font-semibold text-red-600 dark:text-red-400">{props.offline}</span>{" "}
          <span class="text-muted-foreground">offline</span>
        </span>
        <span class="text-muted-foreground">|</span>
        <span>
          <span class="font-semibold">{props.totalSessions}</span>{" "}
          <span class="text-muted-foreground">active sessions</span>
        </span>
        {props.totalBlocked > 0 && (
          <span class="text-amber-500">
            <span class="font-semibold">{props.totalBlocked}</span> blocked
          </span>
        )}
      </div>
      <button
        class="inline-flex items-center justify-center rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
        disabled={props.refreshing}
        onClick={props.onRefreshAll}
        title="Refresh all servers"
      >
        {props.refreshing ? "Refreshing..." : "Refresh All"}
      </button>
    </div>
  )
}
