import { createSignal, createMemo, onMount, For, Show, createResource } from "solid-js"
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
    { value: "updated" as FleetSortKey, label: t("fleet.sort.updated") },
    { value: "sessions" as FleetSortKey, label: t("fleet.sort.sessions") },
    { value: "projects" as FleetSortKey, label: t("fleet.sort.projects") },
  ]

/* Skeleton card for initial loading */
function SkeletonCard() {
  return (
    <div class="flex flex-col gap-2 rounded-lg border bg-card p-3 animate-pulse" aria-hidden="true">
      <div class="flex justify-between"><div class="h-4 w-32 rounded bg-muted" /><div class="h-4 w-16 rounded bg-muted" /></div>
      <div class="h-3 w-48 rounded bg-muted" />
      <div class="h-3 w-40 rounded bg-muted" />
      <div class="h-8 w-full rounded bg-muted mt-1" />
    </div>
  )
}

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

  // Track initial load
  const [initialLoadDone, setInitialLoadDone] = createSignal(false)

  onMount(() => {
    ctrl.refreshAll().finally(() => setInitialLoadDone(true))
  })

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

  // Active filter count (excluding "all")
  const activeFilterCount = createMemo(() => {
    let count = 0
    if (statusFilter() !== "all") count++
    if (connectionFilter() !== "all") count++
    if (searchQuery().trim().length > 0) count++
    return count
  })

  // Whether results are empty due to filters vs truly empty fleet
  const hasServers = createMemo(() => ctrl.servers().length > 0)
  const filtersActive = () => activeFilterCount() > 0
  const noResultsFromFilters = () => hasServers() && filtersActive() && displayedServers().length === 0

  const clearFilters = () => {
    setStatusFilter("all")
    setConnectionFilter("all")
    setSearchQuery("")
  }

  const serverList = () => ctrl.servers()
  // Memoised last-refresh time
  const lastRefreshDisplay = createMemo(() => {
    const t = ctrl.lastRefreshTime()
    return t ? new Date(t).toLocaleTimeString() : ""
  })

  return (
    <div class="flex flex-col gap-4 p-4 max-w-full overflow-x-hidden">
      {/* Header */}
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-semibold">{t("fleet.page.title")}</h1>
        <span class="text-xs text-muted-foreground" aria-live="polite" aria-atomic="true">
          {lastRefreshDisplay()
            ? t("fleet.page.lastUpdated", { time: lastRefreshDisplay() })
            : initialLoadDone() ? "" : t("fleet.page.loading")}
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
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative">
          <input type="search"
                 placeholder={t("fleet.search.placeholder")}
                 class="h-8 w-40 sm:w-48 rounded border bg-background px-2 pr-7 text-xs focus-visible:outline-2 focus-visible:outline-ring"
                 value={searchQuery()}
                 onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                 aria-label={t("fleet.search.placeholder")} />
          {searchQuery().length > 0 && (
            <button class="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setSearchQuery("")}
                    aria-label={t("fleet.search.clear")}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg>
            </button>
          )}
        </div>

        <div class="flex items-center gap-1 flex-wrap" role="group" aria-label={t("fleet.filter.statusGroup")}>
          <For each={filterOptions()}>
            {(opt) => (
              <button class={`rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring min-h-[28px] ${
                statusFilter() === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-accent text-accent-foreground hover:bg-accent/70"
              }`}
                      onClick={() => setStatusFilter(opt.value)}
                      aria-pressed={statusFilter() === opt.value}>
                {opt.label}
              </button>
            )}
          </For>
        </div>

        <select class="h-7 rounded border bg-background px-1 text-xs focus-visible:outline-2 focus-visible:outline-ring"
                value={connectionFilter()}
                onChange={(e) => setConnectionFilter((e.target as HTMLSelectElement).value as FleetConnectionType | "all")}
                aria-label={t("fleet.connectionType.all")}>
          <For each={connectionTypes()}>
            {(opt) => <option value={opt.value}>{opt.label}</option>}
          </For>
        </select>

        <select class="h-7 rounded border bg-background px-1 text-xs focus-visible:outline-2 focus-visible:outline-ring"
                value={sortKey()}
                onChange={(e) => setSortKey((e.target as HTMLSelectElement).value as FleetSortKey)}
                aria-label={t("fleet.sort.label")}>
          <For each={sortOptions()}>
            {(opt) => <option value={opt.value}>{opt.label}</option>}
          </For>
        </select>

        <span class="text-xs text-muted-foreground whitespace-nowrap ml-auto" role="status" aria-live="polite">
          {t("fleet.servers.count", { current: String(displayedServers().length), total: String(serverList().length) })}
        </span>

        <Show when={filtersActive()}>
          <button class="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 whitespace-nowrap"
                  onClick={clearFilters}
                  aria-label={t("fleet.filter.clear", { count: String(activeFilterCount()) })}>
            {t("fleet.filter.clear", { count: String(activeFilterCount()) })}
          </button>
        </Show>
      </div>

      {/* Empty fleet state */}
      <Show when={!initialLoadDone() && !hasServers()}>
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-hidden="true">
          <For each={[1, 2, 3, 4]}>{(i) => <SkeletonCard />}</For>
        </div>
      </Show>

      {/* No servers configured */}
      <Show when={initialLoadDone() && !hasServers() && !filtersActive()}>
        <div class="flex flex-col items-center justify-center py-16 text-center text-muted-foreground" role="status">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-4 opacity-40" aria-hidden="true"><rect x="8" y="8" width="32" height="12" rx="2"/><rect x="8" y="28" width="32" height="12" rx="2"/><circle cx="14" cy="14" r="1.5" fill="currentColor"/><circle cx="14" cy="34" r="1.5" fill="currentColor"/></svg>
          <p class="text-sm font-medium">{t("fleet.empty.title")}</p>
          <p class="text-xs mt-1">{t("fleet.empty.description")}</p>
        </div>
      </Show>

      {/* No results from active filters */}
      <Show when={noResultsFromFilters()}>
        <div class="flex flex-col items-center justify-center py-12 text-center text-muted-foreground" role="status">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" class="mb-3 opacity-40" aria-hidden="true"><circle cx="17" cy="17" r="8"/><path d="M23 23l6 6"/></svg>
          <p class="text-sm font-medium">{t("fleet.noResults.title")}</p>
          <p class="text-xs mt-1">{t("fleet.noResults.description")}</p>
          <button class="mt-3 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                  onClick={clearFilters}>
            {t("fleet.noResults.clearFilters")}
          </button>
        </div>
      </Show>

      {/* Server cards grid */}
      <Show when={hasServers()}>
        <div class="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" role="feed" aria-label={t("fleet.page.title")}>
          <For each={displayedServers()}>
            {(svr) => (
              <FleetServerCard
                server={svr}
                onRefresh={(key: string) => ctrl.refreshOne(key as ServerConnection.Key)}
                onOpen={(key: string) => ctrl.openServer(key as ServerConnection.Key)}
                onEdit={(key: string) => ctrl.editServer(key as ServerConnection.Key)}
                onViewDetails={(key: string) => setSelectedKey(key as ServerConnection.Key)}
                refreshing={refreshingKeys().has(svr.key)}
              />
            )}
          </For>
        </div>
      </Show>

      {/* Live region for screen readers — refresh completion */}
      <div aria-live="polite" aria-atomic="true" class="sr-only">
        {ctrl.refreshing() ? t("fleet.announce.refreshing") : initialLoadDone() && !ctrl.refreshing() ? t("fleet.announce.refreshComplete", { count: String(serverList().length) }) : ""}
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
