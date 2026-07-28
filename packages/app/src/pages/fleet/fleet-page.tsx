import { createSignal, createMemo, onMount, For, Show } from "solid-js"
import { useGlobal } from "@/context/global"
import { useCheckServerHealth } from "@/utils/server-health"
import { ServerConnection, useServer } from "@/context/server"
import { useLanguage } from "@/context/language"
import { createFleetController } from "./fleet-controller"
import { FleetServerCard, FleetSummaryBar, FleetDetailDrawer } from "./components"
import type { FleetFilterStatus, FleetConnectionType, FleetSortKey, FleetServerSnapshot } from "./fleet-types"

const FILTER_OPTIONS = (t: (key: string, params?: Record<string, string | number | boolean>) => string) =>
  [
    { value: "all" as FleetFilterStatus, label: t("fleet.filter.all") },
    { value: "online" as FleetFilterStatus, label: t("fleet.filter.online") },
    { value: "degraded" as FleetFilterStatus, label: t("fleet.filter.degraded") },
    { value: "offline" as FleetFilterStatus, label: t("fleet.filter.offline") },
    { value: "auth-issue" as FleetFilterStatus, label: t("fleet.filter.authIssue") },
  ]

const CONNECTION_TYPES = (t: (key: string, params?: Record<string, string | number | boolean>) => string) =>
  [
    { value: "all" as FleetConnectionType | "all", label: t("fleet.connectionType.all") },
    { value: "http" as FleetConnectionType | "all", label: t("fleet.connectionType.http") },
    { value: "sidecar" as FleetConnectionType | "all", label: t("fleet.connectionType.sidecar") },
    { value: "wsl" as FleetConnectionType | "all", label: t("fleet.connectionType.wsl") },
    { value: "ssh" as FleetConnectionType | "all", label: t("fleet.connectionType.ssh") },
  ]

const SORT_OPTIONS = (t: (key: string, params?: Record<string, string | number | boolean>) => string) =>
  [
    { value: "state" as FleetSortKey, label: t("fleet.sort.state") },
    { value: "name" as FleetSortKey, label: t("fleet.sort.name") },
    { value: "latency" as FleetSortKey, label: t("fleet.sort.latency") },
    { value: "sessions" as FleetSortKey, label: t("fleet.sort.sessions") },
    { value: "projects" as FleetSortKey, label: t("fleet.sort.projects") },
  ]

export function FleetPage() {
  const global = useGlobal()
  const server = useServer()
  const checkHealth = useCheckServerHealth()
  const language = useLanguage()
  const { t } = language

  const ctrl = createFleetController(
    checkHealth,
    { servers: { list: () => global.servers.list() } },
    (conn) => {
      const ctx = global.ensureServerCtx(conn)
      return {
        sync: ctx.sync,
        sdk: ctx.sdk,
      }
    },
  )

  // Wire real app APIs for Open/Edit actions (not custom events)
  ctrl.openHandler = (key: ServerConnection.Key) => {
    server.setActive(key)
  }
  ctrl.editHandler = (key: ServerConnection.Key) => {
    global.settings.server.set(key)
  }

  const [searchQuery, setSearchQuery] = createSignal("")
  const [statusFilter, setStatusFilter] = createSignal<FleetFilterStatus>("all")
  const [connectionFilter, setConnectionFilter] = createSignal<FleetConnectionType | "all">("all")
  const [sortKey, setSortKey] = createSignal<FleetSortKey>("state")
  const [selectedKey, setSelectedKey] = createSignal<ServerConnection.Key | null>(null)

  const filterOptions = createMemo(() => FILTER_OPTIONS(t))
  const connectionTypes = createMemo(() => CONNECTION_TYPES(t))
  const sortOptions = createMemo(() => SORT_OPTIONS(t))

  const displayedServers = createMemo(() => {
    let list = ctrl.servers()
    const q = searchQuery().toLowerCase().trim()
    if (q) {
      list = list.filter(
        (s) => s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q) || s.label?.toLowerCase().includes(q),
      )
    }
    list = ctrl.filterByStatus(list, statusFilter())
    list = ctrl.filterByType(list, connectionFilter())
    return ctrl.sort(list, sortKey())
  })

  const selectedServer = createMemo(() => {
    const key = selectedKey()
    if (!key) return null
    return ctrl.servers().find((s) => s.key === key) ?? null
  })

  const summary = () => ctrl.summary()
  const refreshingKeys = () => ctrl.refreshingKeys()

  onMount(() => {
    ctrl.refreshAll()
  })

  return (
    <div class="flex flex-col gap-4 p-4">
      {/* Header */}
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-semibold">{t("fleet.page.title")}</h1>
        <span class="text-xs text-muted-foreground">
          {ctrl.lastRefreshTime()
            ? t("fleet.page.lastUpdated", { time: new Date(ctrl.lastRefreshTime()!).toLocaleTimeString() })
            : ""}
        </span>
      </div>

      {/* Summary bar */}
      <FleetSummaryBar
        online={summary().online}
        degraded={summary().degraded}
        offline={summary().offline}
        totalSessions={summary().totalRunningSessions}
        totalBlocked={summary().totalBlockedSessions}
        totalServers={summary().totalServers}
        refreshing={ctrl.refreshing()}
        onRefreshAll={() => ctrl.refreshAll()}
      />

      {/* Filters + Search row */}
      <div class="flex flex-wrap items-center gap-3">
        <input type="search" placeholder={t("fleet.search.placeholder")}
               class="h-8 rounded border bg-background px-2 text-xs w-48"
               value={searchQuery()}
               onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)} />

        <div class="flex items-center gap-1 flex-wrap">
          <For each={filterOptions()}>
            {(opt) => (
              <button class={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                statusFilter() === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-accent text-accent-foreground hover:bg-accent/70"
              }`}
                      onClick={() => setStatusFilter(opt.value)}>
                {opt.label}
              </button>
            )}
          </For>
        </div>

        <select class="h-7 rounded border bg-background px-1 text-xs"
                value={connectionFilter()}
                onChange={(e) => setConnectionFilter((e.target as HTMLSelectElement).value as FleetConnectionType | "all")}>
          <For each={connectionTypes()}>
            {(opt) => <option value={opt.value}>{opt.label}</option>}
          </For>
        </select>

        <select class="h-7 rounded border bg-background px-1 text-xs"
                value={sortKey()}
                onChange={(e) => setSortKey((e.target as HTMLSelectElement).value as FleetSortKey)}>
          <For each={sortOptions()}>
            {(opt) => <option value={opt.value}>Sort: {opt.label}</option>}
          </For>
        </select>

        <span class="text-xs text-muted-foreground ml-auto">
          {t("fleet.servers.count", { current: String(displayedServers().length), total: String(ctrl.servers().length) })}
        </span>
      </div>

      {/* Empty state */}
      <Show when={ctrl.servers().length === 0}>
        <div class="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <p class="text-sm font-medium">{t("fleet.empty.title")}</p>
          <p class="text-xs mt-1">{t("fleet.empty.description")}</p>
        </div>
      </Show>

      {/* Server cards grid */}
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <For each={displayedServers()}>
          {(server) => (
            <FleetServerCard
              server={server}
              onRefresh={(key: string) => ctrl.refreshOne(key as ServerConnection.Key)}
              onOpen={(key: string) => ctrl.openServer(key as ServerConnection.Key)}
              onEdit={(key: string) => ctrl.editServer(key as ServerConnection.Key)}
              onViewDetails={(key: string) => setSelectedKey(key as ServerConnection.Key)}
              refreshing={refreshingKeys().has(server.key)}
            />
          )}
        </For>
      </div>

      {/* Detail drawer */}
      <FleetDetailDrawer
        server={selectedServer}
        onClose={() => setSelectedKey(null)}
        onRefresh={(key: string) => ctrl.refreshOne(key as ServerConnection.Key)}
      />
    </div>
  )
}
