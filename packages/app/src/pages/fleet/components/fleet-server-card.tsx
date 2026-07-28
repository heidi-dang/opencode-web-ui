
import { type FleetServerSnapshot } from "../fleet-types"
import { FleetStatusBadge } from "./fleet-status-badge"
import { formatRelativeTime } from "../fleet-format"
import { useLanguage } from "@/context/language"

interface ServerCardProps {
  server: FleetServerSnapshot
  onRefresh: (key: string) => void
  onOpen: (key: string) => void
  onEdit: (key: string) => void
  onViewDetails: (key: string) => void
  refreshing: boolean
}

export function FleetServerCard(props: ServerCardProps) {
  const s = () => props.server
  const { t } = useLanguage()
  const connTypeLabel = () => {
    const ct = s().connectionType
    return ct === "wsl" ? t("fleet.connectionType.wsl") : ct === "ssh" ? t("fleet.connectionType.ssh") : ct === "sidecar" ? t("fleet.connectionType.sidecar") : t("fleet.connectionType.http")
  }

  return (
    <div class="relative flex flex-col gap-1 rounded-lg border bg-card p-3 text-card-foreground shadow-xs transition hover:shadow-md"
         data-server-key={s().key}
         data-server-state={s().health.state}>
      {/* Row 1: name + status */}
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <button class="truncate text-sm font-medium hover:underline text-left cursor-pointer bg-transparent border-0 p-0"
                  onClick={(e) => { e.stopPropagation(); props.onViewDetails(s().key) }}
                  title={s().name}>
            {s().name}
          </button>
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
        {s().protocol.kind ? <span>v{s().protocol.kind}</span> : null}
        {s().health.version ? <span>v{s().health.version}</span> : null}
        {s().health.checkedAt ? <span class="lowercase">{formatRelativeTime(s().health.checkedAt)}</span> : null}
      </div>

      {/* Row 3: metrics */}
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span title={t("fleet.card.sessions")}>
          <span class="font-mono">{s().sessions.running}</span> {t("fleet.card.sessions")}
        </span>
        {s().sessions.permissionBlocked > 0 || s().sessions.questionBlocked > 0 ? (
          <span class="text-amber-500" title={t("fleet.card.blocked")}>
            <span class="font-mono">{s().sessions.permissionBlocked + s().sessions.questionBlocked}</span> {t("fleet.card.blocked")}
          </span>
        ) : null}
        <span title={t("fleet.card.projects")}>
          <span class="font-mono">{s().projects.open}/{s().projects.known}</span> {t("fleet.card.projects")}
        </span>
        <span title={t("fleet.card.providers")}>
          <span class="font-mono">{s().providers.connected}/{s().providers.configured}</span> {t("fleet.card.providers")}
        </span>
      </div>

      {/* Row 4: actions — stopPropagation prevents card bubbling */}
      <div class="flex items-center gap-1 pt-1 border-t border-border mt-1"
           onClick={(e) => e.stopPropagation()}>
        <button class="inline-flex items-center justify-center rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
                disabled={props.refreshing}
                onClick={() => props.onRefresh(s().key)}
                title={t("fleet.card.refresh")}>
          {t("fleet.card.refresh")}
        </button>
        <button class="inline-flex items-center justify-center rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={() => props.onOpen(s().key)}
                title={t("fleet.card.open")}>
          {t("fleet.card.open")}
        </button>
        <button class="inline-flex items-center justify-center rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={() => props.onEdit(s().key)}
                title={t("fleet.card.edit")}>
          {t("fleet.card.edit")}
        </button>
        <button class="ml-auto inline-flex items-center justify-center rounded px-2 py-1 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={() => props.onViewDetails(s().key)}
                title={t("fleet.card.details")}>
          {t("fleet.card.details")}
        </button>
      </div>
    </div>
  )
}
