import { useLanguage } from "@/context/language"

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

/* Inline SVG icons for KPIs */
function ServerIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="12" height="4" rx="1"/><rect x="2" y="10" width="12" height="4" rx="1"/><circle cx="5" cy="4" r=".5" fill="currentColor"/><circle cx="5" cy="12" r=".5" fill="currentColor"/></svg>
}
function CheckCircleIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M5.5 8l2 2 3-3.5"/></svg>
}
function AlertTriangleIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2L1.5 14h13L8 2z"/><path d="M8 6v3"/><circle cx="8" cy="11" r=".5" fill="currentColor"/></svg>
}
function XCircleIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5"/></svg>
}
function SessionIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12"/><circle cx="14" cy="4" r=".75" fill="currentColor"/><circle cx="14" cy="8" r=".75" fill="currentColor"/><circle cx="14" cy="12" r=".75" fill="currentColor"/></svg>
}
function RefreshIcon() {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 7a6 6 0 0111.4-3M13 7a6 6 0 01-11.4 3"/><path d="M13 1v4.5H8.5M1 13V8.5H5.5"/></svg>
}

function KpiBlock(props: { icon: any; value: number; label: string; accent?: string; tooltip?: string }) {
  return (
    <div class="flex items-center gap-2 min-w-0" title={props.tooltip ?? props.label}>
      <span class="shrink-0 text-muted-foreground">{props.icon}</span>
      <span class="flex items-baseline gap-1 min-w-0">
        <span class={`font-semibold tabular-nums ${props.accent ?? ""}`}>{props.value}</span>
        <span class="text-xs text-muted-foreground truncate">{props.label}</span>
      </span>
    </div>
  )
}

export function FleetSummaryBar(props: SummaryBarProps) {
  const { t } = useLanguage()
  return (
    <div class="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2 text-sm" role="region" aria-label={t("fleet.summary.ariaLabel")}>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 min-w-0">
        <KpiBlock icon={<ServerIcon />} value={props.totalServers} label={t("fleet.summary.totalServers")} tooltip={t("fleet.summary.totalServers")} />
        <span class="text-muted-foreground/40 hidden sm:inline" aria-hidden="true">|</span>
        <KpiBlock icon={<CheckCircleIcon />} value={props.online} label={t("fleet.summary.online")} accent="text-green-600 dark:text-green-400" tooltip={t("fleet.summary.online")} />
        {props.degraded > 0 && (
          <KpiBlock icon={<AlertTriangleIcon />} value={props.degraded} label={t("fleet.summary.degraded")} accent="text-amber-600 dark:text-amber-400" tooltip={t("fleet.summary.degraded")} />
        )}
        <KpiBlock icon={<XCircleIcon />} value={props.offline} label={t("fleet.summary.offline")} accent="text-red-600 dark:text-red-400" tooltip={t("fleet.summary.offline")} />
        <span class="text-muted-foreground/40 hidden sm:inline" aria-hidden="true">|</span>
        <KpiBlock icon={<SessionIcon />} value={props.totalSessions} label={t("fleet.summary.activeSessions")} tooltip={t("fleet.summary.activeSessionsTooltip")} />
        {props.totalBlocked > 0 && (
          <KpiBlock icon={<AlertTriangleIcon />} value={props.totalBlocked} label={t("fleet.summary.blocked")} accent="text-amber-500" tooltip={t("fleet.summary.blockedTooltip")} />
        )}
      </div>
      <button class="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring min-h-[36px] min-w-[44px]"
              disabled={props.refreshing}
              onClick={props.onRefreshAll}
              aria-label={t("fleet.summary.refreshAll")}>
        <span class={`${props.refreshing ? "animate-spin" : ""}`}><RefreshIcon /></span>
        <span>{props.refreshing ? t("fleet.summary.refreshing") : t("fleet.summary.refreshAll")}</span>
      </button>
    </div>
  )
}
