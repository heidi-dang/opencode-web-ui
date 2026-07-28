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
function ExternalLinkIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 2H2v8h8V7M6.5 5.5L10 2M8 2h2v2"/></svg>
}
function RefreshCwIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 6a5 5 0 019.5-2.5M11 6a5 5 0 01-9.5 2.5"/><path d="M11 1.5V4.5H8M1 10.5V7.5H4"/></svg>
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
      class={`flex flex-col gap-2.5 rounded-lg border border-l-2 bg-card p-4 text-card-foreground shadow-xs transition h-full ${borderClass()}`}
      data-server-key={s().key}
      data-server-state={s().health.state}
      role="article"
      aria-label={`${t("fleet.card.serverLabel")} ${s().name}`}
    >
      {/* Header row: URL + external link icon + latency + health badge */}
      <div class="flex items-center gap-2">
        <span class="text-xs text-muted-foreground truncate flex-1 min-w-0" title={s().url}>{s().url}</span>
        <span class="shrink-0 text-muted-foreground" aria-hidden="true"><ExternalLinkIcon /></span>
        {s().health.latencyMs !== undefined ? (
          <span class="shrink-0 text-xs font-mono tabular-nums text-muted-foreground">{formatLatency(s().health.latencyMs)}</span>
        ) : null}
        <div class="shrink-0">
          <FleetStatusBadge state={s().health.state} latencyMs={s().health.latencyMs} />
        </div>
      </div>

      {/* Badges row: Online + HTTP + v1 */}
      <div class="flex items-center gap-1.5 flex-wrap">
        <span class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
          s().health.state === "online" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" :
          s().health.state === "degraded" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" :
          s().health.state === "offline" || s().health.state === "auth-failed" ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" :
          s().health.state === "auth-required" ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" :
          "bg-muted text-muted-foreground"
        }`} role="status">
          {s().health.state === "online" ? "Online" :
           s().health.state === "degraded" ? "Degraded" :
           s().health.state === "offline" ? "Offline" :
           s().health.state === "auth-required" ? "Auth Required" :
           s().health.state === "auth-failed" ? "Auth Failed" :
           "Checking"}
        </span>
        <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">{connTypeLabel()}</span>
        {s().protocol.kind ? (
          <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">v{s().protocol.kind}</span>
        ) : null}
      </div>

      {/* Body: Version, Latency, Last check */}
      <div class="flex flex-col gap-1 text-xs text-muted-foreground">
        <div class="flex items-center gap-4">
          <span class="w-16 shrink-0">{t("fleet.card.version")}</span>
          <span class="font-mono tabular-nums">{s().health.version ?? "\u2014"}</span>
        </div>
        <div class="flex items-center gap-4">
          <span class="w-16 shrink-0">{t("fleet.card.latency")}</span>
          <span class="font-mono tabular-nums">{s().health.latencyMs !== undefined ? formatLatency(s().health.latencyMs) : "\u2014"}</span>
        </div>
        <div class="flex items-center gap-4">
          <span class="w-16 shrink-0">{t("fleet.card.lastCheck")}</span>
          <span>{s().health.checkedAt ? formatRelativeTime(s().health.checkedAt) : "\u2014"}</span>
        </div>
      </div>

      {/* Metrics row: Sessions | Projects | Providers */}
      <div class="flex items-center gap-4 text-xs pt-0.5">
        <span title={t("fleet.card.sessions")}>
          <span class="font-mono tabular-nums">{s().sessions.running}</span>
          <span class="text-muted-foreground ml-1">{t("fleet.card.sessions")}</span>
        </span>
        <span class="text-muted-foreground/30" aria-hidden="true">|</span>
        <span title={t("fleet.card.projects")}>
          <span class="font-mono tabular-nums">{s().projects.known}</span>
          <span class="text-muted-foreground ml-1">{t("fleet.card.projects")}</span>
        </span>
        <span class="text-muted-foreground/30" aria-hidden="true">|</span>
        <span title={t("fleet.card.providers")}>
          <span class="font-mono tabular-nums">{s().providers.connected}/{s().providers.configured}</span>
          <span class="text-muted-foreground ml-1">{t("fleet.card.providers")}</span>
        </span>
      </div>

      {/* Footer: evenly-spaced action buttons */}
      <div class="flex items-center justify-between gap-1 pt-1.5 mt-auto border-t border-border">
        <button class="inline-flex items-center gap-1 justify-center rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40 min-h-[32px] flex-1"
                disabled={props.refreshing}
                onClick={() => props.onRefresh(s().key)}
                aria-label={`${t("fleet.card.refresh")} ${s().name}`}>
          <span class={props.refreshing ? "animate-spin" : ""}><RefreshCwIcon /></span>
          <span>{t("fleet.card.refresh")}</span>
        </button>
        <button class="inline-flex items-center gap-1 justify-center rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground min-h-[32px] flex-1"
                onClick={() => props.onOpen(s().key)}
                aria-label={`${t("fleet.card.open")} ${s().name}`}>
          <ExternalLinkIcon />
          <span>{t("fleet.card.open")}</span>
        </button>
        <button class="inline-flex items-center gap-1 justify-center rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground min-h-[32px] flex-1"
                onClick={() => props.onEdit(s().key)}
                aria-label={`${t("fleet.card.edit")} ${s().name}`}>
          <SettingsIcon />
          <span>{t("fleet.card.edit")}</span>
        </button>
        <button class="inline-flex items-center gap-1 justify-center rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground min-h-[32px] flex-1"
                onClick={() => props.onViewDetails(s().key)}
                aria-label={`${t("fleet.card.details")} ${s().name}`}>
          <InfoIcon />
          <span>{t("fleet.card.details")}</span>
        </button>
      </div>
    </div>
  )
}
