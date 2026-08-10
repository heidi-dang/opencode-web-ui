import { createSignal, createMemo, onMount, onCleanup, For, Show } from "solid-js"
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
    <div class="flex flex-col gap-2 rounded-lg border bg-v2-background-bg-layer-01 p-3 animate-pulse" aria-hidden="true">
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

  // Focus the search input with the advertised shortcut (⌘K / Ctrl K).
  // The fleet route registers no command palette, so the key is free here.
  let searchInput: HTMLInputElement | undefined
  const searchHint = () =>
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"

  onMount(() => {
    ctrl.refreshAll().finally(() => setInitialLoadDone(true))
    const onSearchShortcut = (event: KeyboardEvent) => {
      const mod = navigator.platform?.toLowerCase().includes("mac") ? event.metaKey : event.ctrlKey
      if (!mod || event.key.toLowerCase() !== "k") return
      if (!searchInput) return
      event.preventDefault()
      searchInput.focus()
      searchInput.select()
    }
    window.addEventListener("keydown", onSearchShortcut)
    onCleanup(() => window.removeEventListener("keydown", onSearchShortcut))
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

  // Compute additional KPI values from server list
  const extendedSummary = createMemo(() => {
    const base = summary()
    const servers = ctrl.servers()
    let authIssue = 0
    let totalProjects = 0
    let totalProviders = 0
    for (const s of servers) {
      if (s.health.state === "auth-required" || s.health.state === "auth-failed") authIssue++
      totalProjects += s.projects.known
      totalProviders += s.providers.connected
    }
    return { ...base, authIssue, totalProjects, totalProviders }
  })

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

  const drawerOpen = () => selectedKey() !== null

  return (
    <div class="flex flex-col max-w-full min-h-0">
      {/* Two-column layout: main content + sidebar drawer (desktop) */}
      <div class="flex flex-1 min-h-0">
        {/* Main content area */}
        <div class="flex-1 min-w-0 flex flex-col gap-4 p-4 overflow-x-hidden">
          {/* Header row */}
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-2">
            <h1 class="text-xl font-semibold tracking-tight">{t("fleet.page.title")}</h1>
            <div class="hidden sm:flex flex-1 justify-center items-center gap-2 text-xs text-v2-text-text-muted" aria-live="polite" aria-atomic="true">
              <Show when={lastRefreshDisplay() || (!initialLoadDone())}>
                <div
                  class="h-2 w-2 rounded-full"
                  style={{
                    background: "var(--v2-state-fg-success)",
                    "box-shadow": "var(--v2-glow-status-success)",
                  }}
                />
              </Show>
              {lastRefreshDisplay()
                ? t("fleet.page.lastUpdated", { time: lastRefreshDisplay() })
                : initialLoadDone() ? "" : t("fleet.page.loading")}
            </div>
            <div class="flex items-center gap-2">
              <div class="sm:hidden flex items-center gap-2 text-xs text-v2-text-text-muted">
                 <Show when={lastRefreshDisplay() || (!initialLoadDone())}>
                  <div
                    class="h-2 w-2 rounded-full"
                    style={{
                      background: "var(--v2-state-fg-success)",
                      "box-shadow": "var(--v2-glow-status-success)",
                    }}
                  />
                 </Show>
              </div>
              <button
                class="inline-flex items-center gap-2 rounded-md bg-blue-600 text-white px-4 py-2 text-sm font-medium transition-colors hover:bg-blue-700 shadow-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"
                disabled={ctrl.refreshing()}
                onClick={() => ctrl.refreshAll()}
                aria-label={t("fleet.summary.refreshAll")}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class={ctrl.refreshing() ? "animate-spin" : ""} aria-hidden="true"><path d="M1 7a6 6 0 0111.4-3M13 7a6 6 0 01-11.4 3"/><path d="M13 1v4.5H8.5M1 13V8.5H5.5"/></svg>
                <span>{t("fleet.summary.refreshAll")}</span>
              </button>
            </div>
          </div>

          {/* KPI Grid */}
          <FleetSummaryBar
            online={extendedSummary().online}
            degraded={extendedSummary().degraded}
            offline={extendedSummary().offline}
            authIssue={extendedSummary().authIssue}
            totalSessions={extendedSummary().totalRunningSessions}
            totalProjects={extendedSummary().totalProjects}
            totalProviders={extendedSummary().totalProviders}
            totalServers={extendedSummary().totalServers}
            refreshing={ctrl.refreshing()}
            onRefreshAll={() => ctrl.refreshAll()}
          />

          {/* Toolbar: Search + Filters */}
          <div class="flex flex-wrap items-center gap-3 mt-2">
            {/* Search input with Ctrl+K hint */}
            <div class="relative w-full sm:w-64">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" class="absolute left-3 top-1/2 -translate-y-1/2 text-v2-text-text-muted" aria-hidden="true"><circle cx="6" cy="6" r="4.5"/><path d="M9.5 9.5L13 13"/></svg>
              <input type="search"
                     ref={searchInput}
                     placeholder={t("fleet.search.placeholder")}
                     class="h-9 w-full rounded-md border border-v2-border-border-base/50 bg-v2-background-bg-layer-01/40 pl-9 pr-14 text-sm focus-visible:outline-2 focus-visible:outline-ring transition-colors hover:bg-v2-background-bg-layer-01/60"
                     value={searchQuery()}
                     onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                     aria-label={t("fleet.search.placeholder")} />
              <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center rounded border border-v2-border-border-base bg-v2-background-bg-base px-1.5 py-0.5 text-[10px] font-medium text-v2-text-text-muted pointer-events-none">
                {searchHint()}
              </div>
            </div>

            {/* Status filter pills */}
            <div class="flex items-center rounded-md border border-v2-border-border-base/50 bg-v2-background-bg-layer-01/40 p-1" role="group" aria-label={t("fleet.filter.statusGroup")}>
              <For each={filterOptions()}>
                {(opt) => (
                  <button class={`rounded px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
                    statusFilter() === opt.value
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-v2-text-text-muted hover:text-v2-text-text-base hover:bg-v2-background-bg-layer-02/50"
                  }`}
                          onClick={() => setStatusFilter(opt.value)}
                          aria-pressed={statusFilter() === opt.value}>
                    {opt.label}
                  </button>
                )}
              </For>
            </div>

            {/* All Types dropdown */}
            <select class="h-9 rounded-md border border-v2-border-border-base/50 bg-v2-background-bg-layer-01/40 px-3 text-sm text-v2-text-text-base focus-visible:outline-2 focus-visible:outline-ring hover:bg-v2-background-bg-layer-01/60 transition-colors"
                    value={connectionFilter()}
                    onChange={(e) => setConnectionFilter((e.target as HTMLSelectElement).value as FleetConnectionType | "all")}
                    aria-label={t("fleet.connectionType.all")}>
              <For each={connectionTypes()}>
                {(opt) => <option value={opt.value}>{opt.label}</option>}
              </For>
            </select>

            <div class="flex-1" />

            {/* Sort dropdown */}
            <div class="flex items-center gap-2">
              <span class="text-xs text-v2-text-text-muted hidden lg:inline-block">Sort by:</span>
              <select class="h-9 rounded-md border border-v2-border-border-base/50 bg-v2-background-bg-layer-01/40 px-3 text-sm text-v2-text-text-base focus-visible:outline-2 focus-visible:outline-ring hover:bg-v2-background-bg-layer-01/60 transition-colors"
                      value={sortKey()}
                      onChange={(e) => setSortKey((e.target as HTMLSelectElement).value as FleetSortKey)}
                      aria-label={t("fleet.sort.label")}>
                <For each={sortOptions()}>
                  {(opt) => <option value={opt.value}>{opt.label}</option>}
                </For>
              </select>
            </div>

            {/* Active filter chip */}
            <Show when={filtersActive()}>
              <div class="flex items-center gap-2">
                <div class="inline-flex items-center gap-1.5 rounded-md border border-v2-border-border-base/50 bg-v2-background-bg-layer-01/40 px-3 py-1.5 text-xs font-medium text-v2-text-text-base">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-v2-text-text-muted"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                  {activeFilterCount()} active filters
                </div>
                <button class="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-blue-500 hover:text-blue-400 transition-colors"
                        onClick={clearFilters}
                        aria-label={t("fleet.filter.clear", { count: String(activeFilterCount()) })}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  Clear all
                </button>
              </div>
            </Show>
          </div>

          {/* Empty fleet state */}
          <Show when={!initialLoadDone() && !hasServers()}>
            <div class="grid gap-3 grid-cols-1 sm:grid-cols-2" aria-hidden="true">
              <For each={[1, 2]}>{(i) => <SkeletonCard />}</For>
            </div>
          </Show>

          {/* No servers configured */}
          <Show when={initialLoadDone() && !hasServers() && !filtersActive()}>
            <div class="flex flex-col items-center justify-center py-16 text-center text-v2-text-text-muted rounded-lg border bg-v2-background-bg-layer-01" role="status">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-4 opacity-40" aria-hidden="true"><rect x="8" y="8" width="32" height="12" rx="2"/><rect x="8" y="28" width="32" height="12" rx="2"/><circle cx="14" cy="14" r="1.5" fill="currentColor"/><circle cx="14" cy="34" r="1.5" fill="currentColor"/></svg>
              <p class="text-sm font-medium">{t("fleet.empty.title")}</p>
              <p class="text-xs mt-1">{t("fleet.empty.description")}</p>
            </div>
          </Show>

          {/* No results from active filters */}
          <Show when={noResultsFromFilters()}>
            <div class="mt-8 flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-v2-border-border-base/60 bg-transparent py-16 text-center" role="status">
              <div class="mb-4 text-v2-text-text-muted opacity-60">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>
              </div>
              <h3 class="mb-1 text-lg font-medium text-v2-text-text-base">No servers match your filters</h3>
              <p class="mb-6 text-sm text-v2-text-text-muted">Try adjusting your search or filter criteria.</p>
              <button class="inline-flex items-center gap-2 rounded-md border border-v2-border-border-base/50 bg-v2-background-bg-layer-01/40 px-4 py-2 text-sm font-medium text-v2-text-text-base transition-colors hover:bg-v2-background-bg-layer-01/60 focus-visible:outline-2 focus-visible:outline-ring"
                      onClick={clearFilters}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-v2-text-text-muted"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
                Clear all filters
              </button>
            </div>
          </Show>

          {/* Server cards grid */}
          <Show when={hasServers()}>
            <div class="grid gap-3 grid-cols-1 lg:grid-cols-2" role="feed" aria-label={t("fleet.page.title")}>
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

          {/* Live region for screen readers */}
          <div aria-live="polite" aria-atomic="true" class="sr-only">
            {ctrl.refreshing() ? t("fleet.announce.refreshing") : initialLoadDone() && !ctrl.refreshing() ? t("fleet.announce.refreshComplete", { count: String(serverList().length) }) : ""}
          </div>
        </div>

        {/* Desktop sidebar drawer - always rendered when open, sits beside main content */}
        <Show when={drawerOpen()}>
          <div class="hidden lg:block w-[400px] shrink-0 border-l border-v2-border-border-base bg-v2-background-bg-base">
            <FleetDetailDrawer
              server={selectedServer}
              onClose={() => setSelectedKey(null)}
              onRefresh={(key: string) => ctrl.refreshOne(key as ServerConnection.Key)}
              variant="sidebar"
            />
          </div>
        </Show>
      </div>

      {/* Mobile/tablet overlay drawer */}
      <Show when={drawerOpen()}>
        <div class="lg:hidden">
          <FleetDetailDrawer
            server={selectedServer}
            onClose={() => setSelectedKey(null)}
            onRefresh={(key: string) => ctrl.refreshOne(key as ServerConnection.Key)}
            variant="overlay"
          />
        </div>
      </Show>
    </div>
  )
}
