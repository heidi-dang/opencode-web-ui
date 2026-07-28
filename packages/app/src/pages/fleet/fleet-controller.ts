import { useGlobal } from "@/context/global"
import { createStore, reconcile } from "solid-js/store"
import { ServerConnection } from "@/context/server"
import { createMemo, createEffect, onCleanup, on } from "solid-js"
import {
  type FleetController,
  type FleetServerSnapshot,
  type FleetStreamStatus,
  type FleetServerState,
  type FleetConnectionType,
  type FleetFilterStatus,
  type FleetSortKey,
  HEALTH_CONCURRENCY,
  HEALTH_PROBE_TIMEOUT_MS,
} from "./fleet-types"

/* ------------------------------------------------------------------ */
/*  Uncached latency probe                                             */
/* ------------------------------------------------------------------ */

async function probeLatency(
  url: string,
  signal: AbortSignal,
): Promise<{ latencyMs: number; version?: string } | null> {
  const start = performance.now()
  try {
    const res = await fetch(`${url}/health`, { signal, cache: "no-store" })
    if (!res.ok) return null
    const body = await res.json()
    return {
      latencyMs: Math.round(performance.now() - start),
      version: typeof body?.version === "string" ? body.version : undefined,
    }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/*  Async worker pool — bounded concurrency                            */
/* ------------------------------------------------------------------ */

type WorkItem<T> = { task: () => Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }

function createWorkerPool(concurrency: number) {
  const queue: WorkItem<unknown>[] = []
  let active = 0
  let aborted = false

  async function runWorker() {
    while (!aborted) {
      const item = queue.shift()
      if (!item) break
      active++
      try {
        const result = await item.task()
        item.resolve(result)
      } catch (e) {
        item.reject(e)
      } finally {
        active--
        if (!aborted) runWorker() // pick up next
      }
    }
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push({ task, resolve: resolve as (v: unknown) => void, reject })
      if (active < concurrency) runWorker()
    })
  }

  function abort() {
    aborted = true
    queue.length = 0
  }

  return { enqueue, abort, get active() { return active }, get pending() { return queue.length } }
}

/* ------------------------------------------------------------------ */
/*  Snapshot builder                                                    */
/* ------------------------------------------------------------------ */

function buildSnapshot(
  conn: ServerConnection.Any,
  existing: FleetServerSnapshot | undefined,
): FleetServerSnapshot {
  const key = ServerConnection.key(conn)
  return {
    key,
    name: conn.label ?? conn.http.url,
    url: conn.http.url,
    label: conn.label,
    connection: {
      type: (conn as { type?: FleetConnectionType }).type ?? "http",
      local: conn.http.url.startsWith("http://localhost") || conn.http.url.startsWith("http://127.0.0.1"),
    },
    health: {
      state: existing?.health.state ?? "checking",
      healthy: existing?.health.healthy,
      version: existing?.health.version,
      latencyMs: existing?.health.latencyMs,
      checkedAt: existing?.health.checkedAt,
    },
    protocol: {
      kind: existing?.protocol.kind,
    },
    projects: {
      open: existing?.projects.open ?? 0,
      known: existing?.projects.known ?? 0,
    },
    sessions: {
      running: existing?.sessions.running ?? 0,
      busy: existing?.sessions.busy ?? 0,
      permissionBlocked: existing?.sessions.permissionBlocked ?? 0,
      questionBlocked: existing?.sessions.questionBlocked ?? 0,
      totalActive: existing?.sessions.totalActive ?? 0,
    },
    providers: {
      connected: existing?.providers.connected ?? 0,
      configured: existing?.providers.configured ?? 0,
    },
    stream: existing?.stream ?? {
      state: "connecting",
      reconnectCount: 0,
    },
  }
}

/* ------------------------------------------------------------------ */
/*  Controller factory                                                  */
/* ------------------------------------------------------------------ */

export function createFleetController(): FleetController {
  const global = useGlobal()

  /* --- Reactive server list --- */
  const serverList = createMemo<ServerConnection.Any[]>((prev) => {
    const next = global.servers.list()
    if (prev && prev.length === next.length && prev.every((p, i) => p.http.url === next[i].http.url)) {
      return prev
    }
    return next
  }, [] as ServerConnection.Any[])

  /* --- Store: keyed by server connection key --- */
  const [snapshots, setSnapshots] = createStore<Record<string, FleetServerSnapshot>>({})

  /* --- Track which keys have been removed for cleanup --- */
  let knownKeys = new Set<ServerConnection.Key>()
  let probeControllers = new Map<ServerConnection.Key, AbortController>()
  const [refreshingKeys, setRefreshingKeys] = createStore<Record<string, boolean>>({})
  const [isRefreshing, setIsRefreshing] = createStore({ all: false })

  /* --- Re-sync when server list changes --- */
  createEffect(
    on(serverList, (list) => {
      const newKeys = new Set(list.map((conn) => ServerConnection.key(conn)))

      // Clean up probes for removed servers
      for (const key of knownKeys) {
        if (!newKeys.has(key)) {
          probeControllers.get(key)?.abort()
          probeControllers.delete(key)
        }
      }

      knownKeys = newKeys

      setSnapshots(
        reconcile(
          Object.fromEntries(
            list.map((conn) => {
              const key = ServerConnection.key(conn)
              return [key, buildSnapshot(conn, snapshots[key])]
            }),
          ),
        ),
      )
    }),
  )

  /* --- Cleanup on unmount --- */
  onCleanup(() => {
    for (const [_, ctrl] of probeControllers) ctrl.abort()
    probeControllers.clear()
  })

  /* --- Worker pool --- */
  const pool = createWorkerPool(HEALTH_CONCURRENCY)
  onCleanup(() => pool.abort())

  /* --- Visibility-aware, staggered health probing --- */
  let visible = true
  let visibilityTimer: ReturnType<typeof setTimeout> | undefined

  const onVisibility = () => {
    visible = !document.hidden
  }
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility)
    onCleanup(() => document.removeEventListener("visibilitychange", onVisibility))
  }

  /* --- Sorted view: online first, then name --- */
  const sorted = createMemo(() =>
    Object.values(snapshots).sort((a, b) => {
      const order: Record<string, number> = {
        online: 0,
        degraded: 1,
        checking: 2,
        "auth-required": 3,
        "auth-failed": 3,
        offline: 4,
      }
      return (order[a.health.state] ?? 5) - (order[b.health.state] ?? 5) || a.name.localeCompare(b.name)
    }),
  )

  /* --- Summary counters --- */
  const summaryMemo = createMemo(() => {
    const entries = Object.values(snapshots)
    let online = 0
    let degraded = 0
    let offline = 0
    let totalRunningSessions = 0
    let totalBlockedSessions = 0

    for (const s of entries) {
      if (s.health.state === "online") online++
      else if (s.health.state === "degraded") degraded++
      else offline++
      totalRunningSessions += s.sessions.running
      totalBlockedSessions += s.sessions.permissionBlocked + s.sessions.questionBlocked
    }

    return { online, degraded, offline, totalRunningSessions, totalBlockedSessions, totalServers: entries.length }
  })

  let lastRefresh: number | undefined

  /* --- Single server health probe (uncached) --- */
  async function probeOne(conn: ServerConnection.Any, key: ServerConnection.Key) {
    // Cancel any in-flight probe
    probeControllers.get(key)?.abort()
    const abortCtrl = new AbortController()
    probeControllers.set(key, abortCtrl)

    if (!visible) return // skip when hidden

    setSnapshots(key, "health", { state: "checking" })
    setRefreshingKeys(key, true)

    try {
      const result = await probeLatency(conn.http.url, abortCtrl.signal)

      if (abortCtrl.signal.aborted) return

      if (result) {
        setSnapshots(key, "health", {
          state: "online",
          healthy: true,
          version: result.version,
          latencyMs: result.latencyMs,
          checkedAt: Date.now(),
        })
      } else {
        setSnapshots(key, "health", {
          state: "offline",
          healthy: false,
          checkedAt: Date.now(),
        })
      }
    } catch {
      if (!abortCtrl.signal.aborted) {
        setSnapshots(key, "health", { state: "offline", healthy: false, checkedAt: Date.now() })
      }
    } finally {
      setRefreshingKeys(key, false)
    }
  }

  async function refreshOne(key: ServerConnection.Key) {
    for (const conn of global.servers.list()) {
      if (ServerConnection.key(conn) === key) {
        await probeOne(conn, key)
        return
      }
    }
  }

  async function refreshAll() {
    const list = global.servers.list()
    lastRefresh = Date.now()
    setIsRefreshing("all", true)

    // Mark all as checking
    for (const conn of list) {
      const key = ServerConnection.key(conn)
      setSnapshots(key, "health", { state: "checking" })
    }

    // Enqueue all probes through the bounded worker pool
    const promises = list.map((conn) => {
      const key = ServerConnection.key(conn)
      return pool.enqueue(async () => {
        await probeOne(conn, key)
      })
    })

    await Promise.allSettled(promises)
    setIsRefreshing("all", false)
  }

  /* --- Reconnect stream (kick the SDK's event listener) --- */
  function reconnectStream(key: string) {
    setSnapshots(key, "stream", {
      state: "connecting",
      connectedAt: Date.now(),
      reconnectCount: (snapshots[key]?.stream.reconnectCount ?? 0) + 1,
    })
  }

  /* --- Server actions --- */
  function openServer(key: string) {
    window.dispatchEvent(new CustomEvent("opencode:fleet:openServer", { detail: { key } }))
  }

  function openProject(key: string, _directory: string) {
    window.dispatchEvent(new CustomEvent("opencode:fleet:openProject", { detail: { key, directory: _directory } }))
  }

  function openSession(key: string, sessionID: string) {
    window.dispatchEvent(new CustomEvent("opencode:fleet:openSession", { detail: { key, sessionID } }))
  }

  function editServer(key: string) {
    window.dispatchEvent(new CustomEvent("opencode:navigate", { detail: { path: "/settings", tab: "servers" } }))
  }

  function getConnection(key: string): ServerConnection.Any | undefined {
    return global.servers.list().find((conn) => ServerConnection.key(conn) === key)
  }

  return {
    servers: () => sorted(),
    summary: () => summaryMemo(),
    search(query: string) {
      const q = query.toLowerCase()
      return sorted().filter(
        (s) => s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q) || s.label?.toLowerCase().includes(q),
      )
    },
    filterByStatus(list, status) {
      if (status === "all") return list
      if (status === "auth-issue") return list.filter((s) => s.health.state === "auth-required" || s.health.state === "auth-failed")
      return list.filter((s) => s.health.state === status)
    },
    filterByType(list, type) {
      if (type === "all") return list
      return list.filter((s) => s.connection.type === type)
    },
    sort(list, key) {
      const copy = [...list]
      copy.sort((a, b) => {
        switch (key) {
          case "name": return a.name.localeCompare(b.name)
          case "state": return a.health.state.localeCompare(b.health.state)
          case "latency": return (a.health.latencyMs ?? Infinity) - (b.health.latencyMs ?? Infinity)
          case "sessions": return b.sessions.totalActive - a.sessions.totalActive
          case "projects": return b.projects.open - a.projects.open
        }
      })
      return copy
    },
    refreshOne,
    refreshAll,
    reconnectStream,
    openServer,
    openProject,
    openSession,
    editServer,
    getConnection,
    lastRefreshTime: () => lastRefresh,
    refreshing: () => isRefreshing.all,
    refreshingKeys: () => new Set(Object.keys(refreshingKeys).filter((k) => refreshingKeys[k])),
  }
}
