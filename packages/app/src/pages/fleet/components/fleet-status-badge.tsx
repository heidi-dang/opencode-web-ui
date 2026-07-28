import { type FleetServerState } from "../fleet-types"

interface StatusBadgeProps {
  state: FleetServerState
  latencyMs?: number
}

const BADGE_CLASS: Record<FleetServerState, string> = {
  checking: "badge badge-outline text-muted-foreground",
  online: "badge badge-outline text-green-600 dark:text-green-400",
  degraded: "badge badge-outline text-amber-600 dark:text-amber-400",
  offline: "badge badge-outline text-red-600 dark:text-red-400",
  "auth-required": "badge badge-outline text-yellow-600 dark:text-yellow-400",
  "auth-failed": "badge badge-outline text-red-700 dark:text-red-300",
}

export function FleetStatusBadge(props: StatusBadgeProps) {
  const label = props.state === "checking"
    ? "Checking..."
    : props.state === "online"
      ? props.latencyMs !== undefined ? `~${props.latencyMs}ms` : "Online"
      : props.state.charAt(0).toUpperCase() + props.state.slice(1)

  return (
    <span class={BADGE_CLASS[props.state]}>
      {label}
    </span>
  )
}
