import { type FleetServerSnapshot } from "../fleet-types"
import { FleetStatusBadge } from "./fleet-status-badge"
import { formatRelativeTime, formatLatency } from "../fleet-format"
import { useLanguage } from "@/context/language"

interface ServerCardProps {
  server: FleetServerSnapshot
  onRefresh: (key: string) => void
  onOpen: (key: string) => void
  onEdit: (key: string) => void
  onViewDetails: (key: string) => void
  refreshing: boolean
}

/* --- Inline SVG icons --- */
function RefreshCwIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 6a5 5 0 019.5-2.5M11 6a5 5 0 01-9.5 2.5"/><path d="M11 1.5V4.5H8M1 10.5V7.5H4"/></svg>
}
function ExternalLinkIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 2H2v8h8V7M6.5 5.5L10 2M8 2h2v2"/></svg>
}
function SettingsIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="1.5"/><path d="M6 1v1M6 10v1M1.75 3.5l.87.5M9.38 8l.87.5M1.75 8.5l.87-.5M9.38 4l.87-.5M3.5 1.75l.5.87M8 9.38l.5.87M8 2.62l.5-.87M3.5 10.25l.5-.87"/></svg>
}
function InfoIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="6" r="4.5"/><path d="M6 5.5v3M6 3.5v.5"/></svg>
}

const STATE_BORDER: Record<string, string> = {
  online: "border-l-green-500 dark:border-l-green-600",
  degraded: "border-l-amber-500 dark:border-l-amber-600",
  offline: "border-l-red-500 dark:border-l-red-600",
  "auth-required": "border-l-yellow-500 dark:border-l-yellow-600",
  "auth-failed": "border-l-red-700 dark:border-l-red-500",
  checking: "border-l-muted-foreground",
}

export function FleetServerCard(props: ServerCardProps) {
  const s = () => props.server
  const { t } = useLanguage()

  const connTypeLabel = () => {
    const ct = s().connectionType
    return ct === "wsl" ? t("fleet.connectionType.wsl") : ct === "ssh" ? t("fleet.connectionType.ssh") : ct === "sidecar" ? t("fleet.connectionType.sidecar") : t("fleet.connectionType.http")
  }

  const borderClass = () => STATE_BORDER[s().health.state] ?? "border-l-muted"

  return (
    <div
      class={`flex flex-col gap-1.5 rounded-lg border border-l-2 bg-card p-3 text-card-foreground shadow-xs transition ${borderClass()}`}
      data-server-key={s().key}
      data-server-state={s().health.state}
      role="article"
      aria-label={`${t("fleet.card.serverLabel")} ${s().name}`}
    >
      {/* Row 1: name + status badge (top priority) */}
      <div class="flex items-start justify-between gap-2">
        <div class="flex flex-col min-w-0 gap-0.5">
          <button class="truncate text-sm font-medium hover:underline text-left cursor-pointer bg-transparent border-0 p-0 leading-tight"
                  onClick={(e) => { e.stopPropagation(); props.onViewDetails(s().key) }}
                  title={s().name}
                  aria-label={t("fleet.card.viewDetails", { name: s().name })}>
            {s().name}
          </button>
          {s().label && s().label !== s().name ? (
            <span class="text-xs text-muted-foreground truncate">{s().label}</span>
          ) : null}
        </div>
        <div class="shrink-0">
          <FleetStatusBadge state={s().health.state} latencyMs={s().health.latencyMs} />
        </div>
      </div>

      {/* Row 2: connection type + version + protocol + latency + last check */}
      <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span class="truncate max-w-[120px]" title={connTypeLabel()}>{connTypeLabel()}</span>
        {s().protocol.kind ? <span class="shrink-0">v{s().protocol.kind}</span> : null}
        {s().health.version ? <span class="truncate max-w-[80px]" title={s().health.version}>{s().health.version}</span> : null}
        {s().health.latencyMs !== undefined ? <span class="shrink-0">{formatLatency(s().health.latencyMs)}</span> : null}
        {s().health.checkedAt ? <span class="shrink-0 lowercase">{formatRelativeTime(s().health.checkedAt)}</span> : null}
      </div>

      {/* Row 3: metrics — always shows labels even when zero */}
      <div class="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs pt-0.5">
        <span title={t("fleet.card.sessions")}>
          <span class="font-mono tabular-nums">{s().sessions.running}</span>
          <span class="text-muted-foreground ml-0.5">{t("fleet.card.sessions")}</span>
        </span>
        {s().sessions.permissionBlocked > 0 || s().sessions.questionBlocked > 0 ? (
          <span class="text-amber-500" title={t("fleet.card.blocked")}>
            <span class="font-mono tabular-nums">{s().sessions.permissionBlocked + s().sessions.questionBlocked}</span>
            <span class="ml-0.5">{t("fleet.card.blocked")}</span>
          </span>
        ) : null}
        <span title={t("fleet.card.projects")}>
          <span class="font-mono tabular-nums">{s().projects.known}</span>
          <span class="text-muted-foreground ml-0.5">{t("fleet.card.projects")}</span>
        </span>
        <span title={t("fleet.card.providers")}>
          <span class="font-mono tabular-nums">{s().providers.connected}/{s().providers.configured}</span>
          <span class="text-muted-foreground ml-0.5">{t("fleet.card.providers")}</span>
        </span>
      </div>

      {/* Row 4: actions — stopPropagation prevents parent event */}
      <div class="flex items-center gap-1 pt-1.5 mt-0.5 border-t border-border"
           onClick={(e) => e.stopPropagation()}>
        <button class="inline-flex items-center gap-1 justify-center rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40 min-h-[32px] min-w-[44px]"
                disabled={props.refreshing}
                onClick={() => props.onRefresh(s().key)}
                aria-label={`${t("fleet.card.refresh")} ${s().name}`}>
          <span class={`${props.refreshing ? "animate-spin" : ""}`}><RefreshCwIcon /></span>
          <span class="hidden sm:inline">{t("fleet.card.open") === t("fleet.card.open") ? t("fleet.card.refresh") : t("fleet.card.refresh")}</span>
        </button>
        <button class="inline-flex items-center gap-1 justify-center rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground min-h-[32px] min-w-[44px]"
                onClick={() => props.onOpen(s().key)}
                aria-label={`${t("fleet.card.open")} ${s().name}`}>
          <ExternalLinkIcon />
          <span class="hidden sm:inline">{t("fleet.card.open")}</span>
        </button>
        <button class="inline-flex items-center gap-1 justify-center rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground min-h-[32px] min-w-[44px]"
                onClick={() => props.onEdit(s().key)}
                aria-label={`${t("fleet.card.edit")} ${s().name}`}>
          <SettingsIcon />
          <span class="hidden sm:inline">{t("fleet.card.edit")}</span>
        </button>
        <button class="ml-auto inline-flex items-center gap-1 justify-center rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground min-h-[32px] min-w-[44px]"
                onClick={() => props.onViewDetails(s().key)}
                aria-label={`${t("fleet.card.details")} ${s().name}`}>
          <InfoIcon />
          <span class="hidden sm:inline">{t("fleet.card.details")}</span>
        </button>
      </div>
    </div>
  )
}
