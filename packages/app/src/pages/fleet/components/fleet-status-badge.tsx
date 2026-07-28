import { useLanguage } from "@/context/language"
import { type FleetServerState } from "../fleet-types"

interface StatusBadgeProps {
  state: FleetServerState
  latencyMs?: number
}

/* --- Inline SVG icons for color-independent status --- */
function CheckIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6l2.5 2.5 4.5-5"/></svg>
}
function AlertIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="4.5"/><path d="M6 3.5v3M6 8v.5"/></svg>
}
function XIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6"/></svg>
}
function SpinnerIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="animate-spin" aria-hidden="true"><path d="M6 1v2M6 9v2M2.05 2.05l1.41 1.41M8.54 8.54l1.41 1.41M1 6h2M9 6h2M2.05 9.95l1.41-1.41M8.54 3.46l1.41-1.41"/></svg>
}
function LockIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="7" height="5.5" rx="1"/><path d="M4 5V3.5a2 2 0 014 0V5"/></svg>
}

const BADGE_CONFIG: Record<FleetServerState, { class: string; icon: () => any; labelKey: string }> = {
  checking: {
    class: "badge badge-outline text-muted-foreground",
    icon: SpinnerIcon,
    labelKey: "fleet.status.checking",
  },
  online: {
    class: "badge badge-outline text-green-600 dark:text-green-400",
    icon: CheckIcon,
    labelKey: "fleet.status.online",
  },
  degraded: {
    class: "badge badge-outline text-amber-600 dark:text-amber-400",
    icon: AlertIcon,
    labelKey: "fleet.status.degraded",
  },
  offline: {
    class: "badge badge-outline text-red-600 dark:text-red-400",
    icon: XIcon,
    labelKey: "fleet.status.offline",
  },
  "auth-required": {
    class: "badge badge-outline text-yellow-600 dark:text-yellow-400",
    icon: LockIcon,
    labelKey: "fleet.status.authRequired",
  },
  "auth-failed": {
    class: "badge badge-outline text-red-700 dark:text-red-300",
    icon: LockIcon,
    labelKey: "fleet.status.authFailed",
  },
}

export function FleetStatusBadge(props: StatusBadgeProps) {
  const { t } = useLanguage()
  const cfg = BADGE_CONFIG[props.state]
  const Icon = cfg.icon
  const label = props.state === "online" && props.latencyMs !== undefined
    ? `~${props.latencyMs}ms`
    : t(cfg.labelKey)

  return (
    <span class={`inline-flex items-center gap-1 ${cfg.class}`} role="status" aria-label={label}>
      <Icon />
      <span>{label}</span>
    </span>
  )
}
