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
  online: "border-l-green-500",
  degraded: "border-l-amber-500",
  offline: "border-l-red-500",
  "auth-required": "border-l-purple-500",
  "auth-failed": "border-l-red-700",
  checking: "border-l-muted-foreground",
}

// Additional mockup icons
function UsersIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
}
function FolderMockupIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
}
function UsersGroupIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 19a6 6 0 0 0-12 0"/><circle cx="8" cy="9" r="4"/><path d="M22 19a6 6 0 0 0-6-6 4 4 0 1 0 0-8"/></svg>
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
      class={`flex flex-col gap-4 rounded-xl border border-v2-border-border-base/50 border-l-4 bg-v2-background-bg-layer-01/40 p-5 text-card-foreground shadow-sm transition-colors hover:bg-v2-background-bg-layer-01/60 h-full ${borderClass()}`}
      data-server-key={s().key}
      data-server-state={s().health.state}
      role="article"
      aria-label={`${t("fleet.card.serverLabel")} ${s().name}`}
    >
      {/* Header row: URL + external link icon + latency + health badge */}
      <div class="flex items-center gap-2">
        <span class="text-base font-medium truncate flex-1 min-w-0" title={s().url}>{s().url}</span>
        <span class="shrink-0 text-v2-text-text-muted cursor-pointer hover:text-v2-text-text-base transition-colors" aria-hidden="true" onClick={() => props.onOpen(s().key)}><ExternalLinkIcon /></span>
        <div class="shrink-0 flex items-center gap-1.5 ml-2">
          {s().health.latencyMs !== undefined ? (
            <span class="text-xs font-mono tabular-nums text-green-500">{formatLatency(s().health.latencyMs)}</span>
          ) : null}
          <FleetStatusBadge state={s().health.state} latencyMs={s().health.latencyMs} />
        </div>
      </div>

      {/* Badges row: Online + HTTP + v1 */}
      <div class="flex items-center gap-2 flex-wrap">
        <span class={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
          s().health.state === "online" ? "bg-green-500/20 text-green-400" :
          s().health.state === "degraded" ? "bg-amber-500/20 text-amber-400" :
          s().health.state === "offline" || s().health.state === "auth-failed" ? "bg-red-500/20 text-red-400" :
          s().health.state === "auth-required" ? "bg-purple-500/20 text-purple-400" :
          "bg-muted/50 text-v2-text-text-muted"
        }`} role="status">
          {s().health.state === "online" ? "Online" :
           s().health.state === "degraded" ? "Degraded" :
           s().health.state === "offline" ? "Offline" :
           s().health.state === "auth-required" ? "Auth Required" :
           s().health.state === "auth-failed" ? "Auth Failed" :
           "Checking"}
        </span>
        <span class="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-v2-background-bg-layer-02 text-accent-foreground">{connTypeLabel()}</span>
        {s().protocol.kind ? (
          <span class="inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-v2-background-bg-layer-02 text-accent-foreground">v{s().protocol.kind}</span>
        ) : null}
      </div>

      {/* Body: Version, Latency, Last check */}
      <div class="flex flex-col gap-2 text-sm text-v2-text-text-muted py-2 border-b border-v2-border-border-base/40">
        <div class="flex items-center">
          <span class="w-24 shrink-0">{t("fleet.card.version")}</span>
          <span class="font-mono tabular-nums text-v2-text-text-base">{s().health.version ?? "\u2014"}</span>
        </div>
        <div class="flex items-center">
          <span class="w-24 shrink-0">{t("fleet.card.latency")}</span>
          <span class="font-mono tabular-nums text-v2-text-text-base">{s().health.latencyMs !== undefined ? formatLatency(s().health.latencyMs) : "\u2014"}</span>
        </div>
        <div class="flex items-center">
          <span class="w-24 shrink-0">{t("fleet.card.lastCheck")}</span>
          <span class="text-v2-text-text-base">{s().health.checkedAt ? formatRelativeTime(s().health.checkedAt) : "\u2014"}</span>
        </div>
      </div>

      {/* Metrics row: Sessions | Projects | Providers */}
      <div class="flex justify-between items-center text-sm">
        <div class="flex flex-col items-center gap-1" title={t("fleet.card.sessions")}>
          <div class="flex items-center gap-1.5 text-v2-text-text-muted">
            <UsersIcon />
            <span class="text-xs">{t("fleet.card.sessions")}</span>
          </div>
          <span class="font-mono text-base tabular-nums">{s().sessions.running}</span>
        </div>

        <div class="flex flex-col items-center gap-1" title={t("fleet.card.projects")}>
          <div class="flex items-center gap-1.5 text-v2-text-text-muted">
            <FolderMockupIcon />
            <span class="text-xs">{t("fleet.card.projects")}</span>
          </div>
          <span class="font-mono text-base tabular-nums">{s().projects.known}</span>
        </div>

        <div class="flex flex-col items-center gap-1" title={t("fleet.card.providers")}>
          <div class="flex items-center gap-1.5 text-v2-text-text-muted">
            <UsersGroupIcon />
            <span class="text-xs">{t("fleet.card.providers")}</span>
          </div>
          <span class="font-mono text-base tabular-nums">{s().providers.connected}/{s().providers.configured}</span>
        </div>
      </div>

      {/* Footer: evenly-spaced action buttons */}
      <div class="flex items-center gap-2 pt-2 mt-auto">
        <button class="inline-flex flex-1 items-center gap-1.5 justify-center rounded-md border border-v2-border-border-base/50 bg-v2-background-bg-base/50 px-2 py-1.5 text-xs font-medium transition-colors hover:bg-v2-background-bg-layer-02 hover:text-accent-foreground disabled:opacity-40 min-h-[36px]"
                disabled={props.refreshing}
                onClick={() => props.onRefresh(s().key)}
                aria-label={`${t("fleet.card.refresh")} ${s().name}`}>
          <span class={props.refreshing ? "animate-spin" : ""}><RefreshCwIcon /></span>
          <span>{t("fleet.card.refresh")}</span>
        </button>
        <button class="inline-flex flex-1 items-center gap-1.5 justify-center rounded-md bg-blue-600 px-2 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 min-h-[36px] shadow-sm"
                onClick={() => props.onOpen(s().key)}
                aria-label={`${t("fleet.card.open")} ${s().name}`}>
          <ExternalLinkIcon />
          <span>{t("fleet.card.open")}</span>
        </button>
        <button class="inline-flex flex-1 items-center gap-1.5 justify-center rounded-md border border-v2-border-border-base/50 bg-v2-background-bg-base/50 px-2 py-1.5 text-xs font-medium transition-colors hover:bg-v2-background-bg-layer-02 hover:text-accent-foreground min-h-[36px]"
                onClick={() => props.onEdit(s().key)}
                aria-label={`${t("fleet.card.edit")} ${s().name}`}>
          <SettingsIcon />
          <span>{t("fleet.card.edit")}</span>
        </button>
        <button class="inline-flex flex-1 items-center gap-1.5 justify-center rounded-md border border-v2-border-border-base/50 bg-v2-background-bg-base/50 px-2 py-1.5 text-xs font-medium transition-colors hover:bg-v2-background-bg-layer-02 hover:text-accent-foreground min-h-[36px]"
                onClick={() => props.onViewDetails(s().key)}
                aria-label={`${t("fleet.card.details")} ${s().name}`}>
          <InfoIcon />
          <span>{t("fleet.card.details")}</span>
        </button>
      </div>
    </div>
  )
}
