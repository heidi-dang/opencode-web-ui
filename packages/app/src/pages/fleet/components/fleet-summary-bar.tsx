import { useLanguage } from "@/context/language"
import type { JSX } from "solid-js"

interface SummaryBarProps {
  online: number
  degraded: number
  offline: number
  authIssue: number
  totalSessions: number
  totalProjects: number
  totalProviders: number
  totalServers: number
  refreshing: boolean
  onRefreshAll: () => void
}

/* --- Inline SVG icons (18×18) --- */
function ServerIcon() {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="14" height="5" rx="1.5"/><rect x="2" y="11" width="14" height="5" rx="1.5"/><circle cx="5" cy="4.5" r=".75" fill="currentColor"/><circle cx="5" cy="13.5" r=".75" fill="currentColor"/></svg>
}
function CheckCircleIcon() {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="9" r="6.5"/><path d="M6 9l2 2 4-4"/></svg>
}
function AlertTriangleIcon() {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5L2 15.5h14L9 2.5z"/><path d="M9 7v3.5"/><circle cx="9" cy="13" r=".75" fill="currentColor"/></svg>
}
function XCircleIcon() {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="9" r="6.5"/><path d="M6.5 6.5l5 5M11.5 6.5l-5 5"/></svg>
}
function LockIcon() {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="8" width="11" height="7.5" rx="1.5"/><path d="M6 8V5.5a3 3 0 016 0V8"/></svg>
}
function FolderIcon() {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4.5a1.5 1.5 0 011.5-1.5h3.5l2 2h5.5a1.5 1.5 0 011.5 1.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 012 13.5V4.5z"/></svg>
}
function GlobeIcon() {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="9" r="6.5"/><path d="M2.5 9h13M9 2.5A8.5 8.5 0 016 15.5M9 2.5A8.5 8.5 0 0112 15.5"/></svg>
}
function ActivityIcon() {
  return <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4h14M2 9h14M2 14h14"/><circle cx="16" cy="4.5" r=".75" fill="currentColor"/><circle cx="16" cy="9" r=".75" fill="currentColor"/><circle cx="16" cy="14" r=".75" fill="currentColor"/></svg>
}

interface KpiCardProps {
  icon: JSX.Element
  label: string
  value: number | string
  secondary?: string
  accent?: string
  iconAccent?: string
}

function KpiCard(props: KpiCardProps) {
  return (
    <div class="flex flex-col gap-1.5 rounded-lg border bg-v2-background-bg-layer-01 p-3 text-card-foreground shadow-xs min-h-[88px]">
      <div class="flex items-center gap-2">
        <span class={`shrink-0 ${props.iconAccent ?? "text-v2-text-text-muted"}`}>{props.icon}</span>
        <span class="text-xs text-v2-text-text-muted truncate">{props.label}</span>
      </div>
      <span class={`text-2xl font-bold tabular-nums leading-none ${props.accent ?? ""}`}>{props.value}</span>
      {props.secondary ? (
        <span class="text-xs text-v2-text-text-muted">{props.secondary}</span>
      ) : null}
    </div>
  )
}

export function FleetSummaryBar(props: SummaryBarProps) {
  const { t } = useLanguage()

  const authIssueCount = props.authIssue ?? 0
  const projectsCount = props.totalProjects ?? 0
  const providersCount = props.totalProviders ?? 0

  return (
    <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3" role="region" aria-label={t("fleet.summary.ariaLabel")}>
      <KpiCard
        icon={<ServerIcon />}
        label={t("fleet.kpi.totalServers")}
        value={props.totalServers}
      />
      <KpiCard
        icon={<CheckCircleIcon />}
        label={t("fleet.kpi.online")}
        value={props.online}
        secondary={props.totalServers > 0 ? `${Math.round((props.online / props.totalServers) * 100)}%` : "—"}
        accent="text-green-600 dark:text-green-400"
        iconAccent="text-green-600 dark:text-green-400"
      />
      <KpiCard
        icon={<AlertTriangleIcon />}
        label={t("fleet.kpi.degraded")}
        value={props.degraded}
        accent="text-amber-600 dark:text-amber-400"
        iconAccent="text-amber-600 dark:text-amber-400"
      />
      <KpiCard
        icon={<XCircleIcon />}
        label={t("fleet.kpi.offline")}
        value={props.offline}
        accent="text-red-600 dark:text-red-400"
        iconAccent="text-red-600 dark:text-red-400"
      />
      <KpiCard
        icon={<LockIcon />}
        label={t("fleet.kpi.authIssue")}
        value={authIssueCount}
        accent="text-yellow-600 dark:text-yellow-400"
        iconAccent="text-yellow-600 dark:text-yellow-400"
      />
      <KpiCard
        icon={<FolderIcon />}
        label={t("fleet.kpi.projects")}
        value={projectsCount}
      />
      <KpiCard
        icon={<GlobeIcon />}
        label={t("fleet.kpi.providers")}
        value={providersCount}
      />
      <KpiCard
        icon={<ActivityIcon />}
        label={t("fleet.kpi.activeSessions")}
        value={props.totalSessions}
      />
    </div>
  )
}
