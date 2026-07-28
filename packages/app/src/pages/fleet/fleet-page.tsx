import { createSignal, createMemo, onMount, For, Show } from "solid-js"
import { createFleetController } from "./fleet-controller"
import { FleetServerCard, FleetSummaryBar, FleetDetailDrawer } from "./components"
import type { FleetFilterStatus, FleetConnectionType, FleetSortKey } from "./fleet-types"
import type { ServerConnection } from "@/context/server"

const FILTER_OPTIONS: { value: FleetFilterStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "online", label: "Online" },
  { value: "degraded", label: "Degraded" },
  { value: "offline", label: "Offline" },
  { value: "auth-issue", label: "Auth Issue" },
]

const CONNECTION_TYPES: { value: FleetConnectionType | "all"; label: string }[] = [
  { value: "all", label: "All Types" },
  { value: "http", label: "HTTP" },
  { value: "sidecar", label: "Sidecar" },
  { value: "wsl", label: "WSL" },
  { value: "ssh", label: "SSH" },
]

const SORT_OPTIONS: { value: FleetSortKey; label: string }[] = [
  { value: "state", label: "Status" },
  { value: "name", label: "Name" },
  { value: "latency", label: "Latency" },
  { value: "sessions", label: "Sessions" },
  { value: "projects", label: "Projects" },
]

export function FleetPage() {
  const ctrl = createFleetController()

  const [searchQuery, setSearchQuery] = createSignal("")
  const [statusFilter, setStatusFilter] = createSignal<FleetFilterStatus>("all")
  const [connectionFilter, setConnectionFilter] = createSignal<FleetConnectionType | "all">("all")
  const [sortKey, setSortKey] = createSignal<FleetSortKey>("state")
  const [selectedServer, setSelectedServer] = createSignal<ServerConnection.Key | null>(null)

  // Derive the filtered / sorted list
  const displayedServers = createMemo(() => {
    let list = ctrl.servers()

    // Search
    const q = searchQuery().toLowerCase().trim()
    if (q) {
      list = list.filter(
        (s) => s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q) || s.label?.toLowerCase().includes(q),
      )
    }

    // Status filter
    list = ctrl.filterByStatus(list, statusFilter())

    // Connection type filter
    list = ctrl.filterByType(list, connectionFilter())

    // Sort
    list = ctrl.sort(list, sortKey())

    return list
  })

  const summary = () => ctrl.summary()
  const refreshingKeys = () => ctrl.refreshingKeys()

  // Auto-refresh on mount
  onMount(() => {
    ctrl.refreshAll()
  })

  const selectedSnapshot = createMemo(() => {
    const key = selectedServer()
    if (!key) return null
    return ctrl.servers().find((s) => s.key === key) ?? null
  })

  return (
    <div class="flex flex-col gap-4 p-4">
      {/* Header */}
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-semibold">Fleet Dashboard</h1>
        <span class="text-xs text-muted-foreground">
          {ctrl.lastRefreshTime()
            ? `Last updated ${new Date(ctrl.lastRefreshTime()!).toLocaleTimeString()}`
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
        {/* Search */}
        <input
          type="search"
          placeholder="Search servers..."
          class="h-8 rounded border bg-background px-2 text-xs w-48"
          value={searchQuery()}
          onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
        />

        {/* Status pills */}
        <div class="flex items-center gap-1 flex-wrap">
          <For each={FILTER_OPTIONS}>
            {(opt) => (
              <button
                class={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  statusFilter() === opt.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-accent text-accent-foreground hover:bg-accent/70"
                }`}
                onClick={() => setStatusFilter(opt.value)}
              >
                {opt.label}
              </button>
            )}
          </For>
        </div>

        {/* Connection type filter */}
        <select
          class="h-7 rounded border bg-background px-1 text-xs"
          value={connectionFilter()}
          onChange={(e) => setConnectionFilter((e.target as HTMLSelectElement).value as FleetConnectionType | "all")}
        >
          <For each={CONNECTION_TYPES}>
            {(opt) => <option value={opt.value}>{opt.label}</option>}
          </For>
        </select>

        {/* Sort */}
        <select
          class="h-7 rounded border bg-background px-1 text-xs"
          value={sortKey()}
          onChange={(e) => setSortKey((e.target as HTMLSelectElement).value as FleetSortKey)}
        >
          <For each={SORT_OPTIONS}>
            {(opt) => <option value={opt.value}>Sort: {opt.label}</option>}
          </For>
        </select>

        {/* Server count */}
        <span class="text-xs text-muted-foreground ml-auto">
          {displayedServers().length} / {ctrl.servers().length} servers
        </span>
      </div>

      {/* Empty state */}
      <Show when={ctrl.servers().length === 0}>
        <div class="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <p class="text-sm font-medium">No servers connected</p>
          <p class="text-xs mt-1">Add a server in Settings to get started.</p>
        </div>
      </Show>

      {/* Server cards grid */}
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        <For each={displayedServers()}>
          {(server) => (
            <div class="cursor-pointer" onClick={() => setSelectedServer(server.key)}>
              <FleetServerCard
                server={server}
                onRefresh={(key) => ctrl.refreshOne(key)}
                onOpen={(key) => ctrl.openServer(key)}
                onEdit={(key) => ctrl.editServer(key)}
                onReconnect={(key) => ctrl.reconnectStream(key)}
                refreshing={refreshingKeys().has(server.key)}
              />
            </div>
          )}
        </For>
      </div>

      {/* Detail drawer */}
      <Show when={selectedServer() !== null}>
        <FleetDetailDrawer
          server={selectedSnapshot()}
          onClose={() => setSelectedServer(null)}
          onRefresh={(key) => ctrl.refreshOne(key)}
          onReconnect={(key) => ctrl.reconnectStream(key)}
        />
      </Show>
    </div>
  )
}
