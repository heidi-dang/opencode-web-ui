
import { createStore, reconcile } from "solid-js/store"
import { createMemo, createEffect, onCleanup, on } from "solid-js"
import { ServerConnection } from "@/context/server"
import type { ServerHealth } from "@/utils/server-health"
import type { FleetController, FleetServerSnapshot, FleetConnectionType } from "./fleet-types"
import { HEALTH_CONCURRENCY, HEALTH_PROBE_TIMEOUT_MS, POLL_INTERVAL_MS, normalizeConnectionType } from "./fleet-types"

/* ------------------------------------------------------------------ */
/*  Worker pool — exactly HEALTH_CONCURRENCY persistent workers        */
/*  Rejects queued promises on abort.                                  */
/* ------------------------------------------------------------------ */

function createWorkerPool(concurrency: number) {
  const queue: Array<() => Promise<unknown>> = []
  const pendingRejects: Array<(reason: unknown) => void> = []
  let pendingResolvers: Array<() => void> = []
  const abortController = new AbortController()
  const signal = abortController.signal

  async function workerLoop() {
    while (!signal.aborted) {
      const task = queue.shift()
      if (task) {
        try { await task() } catch { /* worker continues regardless */ }
        continue
      }
      // No work — sleep until notified
      await new Promise<void>((resolve) => {
        if (signal.aborted) { resolve(); return }
        pendingResolvers.push(resolve)
      })
    }
  }

  // Start exactly `concurrency` persistent workers
  for (let i = 0; i < concurrency; i++) workerLoop()

  function notify() {
    const resolvers = pendingResolvers.splice(0)
    for (const r of resolvers) r()
  }

  async function enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal.aborted) { reject(new Error("Worker pool aborted")); return }
      pendingRejects.push(reject)
      queue.push(async () => {
        try { resolve(await task()) } catch (e) { reject(e) }
      })
      notify()
    })
  }

  function abort() {
    abortController.abort()
    pendingResolvers.splice(0).forEach(r => r())
    const rejects = pendingRejects.splice(0)
    const err = new Error("Worker pool aborted")
    for (const r of rejects) r(err)
  }

  return { enqueue, abort, get pending() { return queue.length } }
}

/* ------------------------------------------------------------------ */
/*  Health + latency measured together so latency is always authed     */
/*  Uses the injected platform-aware checkHealthFn (not raw fetch).    */
/* ------------------------------------------------------------------ */

async function healthWithLatency(
  checkHealthFn: (http: ServerConnection.HttpBase) => Promise<ServerHealth>,
  http: ServerConnection.HttpBase,
  signal: AbortSignal,
): Promise<{ health: ServerHealth; latencyMs: number | null }> {
  const start = performance.now()
  try {
    const health = await checkHealthFn(http)
    if (signal.aborted) return { health, latencyMs: null }
    return { health, latencyMs: Math.round(performance.now() - start) }
  } catch {
    if (signal.aborted) return { health: { healthy: false }, latencyMs: null }
    return { health: { healthy: false }, latencyMs: Math.round(performance.now() - start) }
  }
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
    connectionType: normalizeConnectionType(conn),
    health: {
      state: existing?.health.state ?? "checking",
      healthy: existing?.health.healthy,
      version: existing?.health.version,
      latencyMs: existing?.health.latencyMs,
      checkedAt: existing?.health.checkedAt,
    },
    protocol: { kind: existing?.protocol.kind },
    projects: existing?.projects ?? { open: 0, known: 0 },
    sessions: existing?.sessions ?? {
      running: 0, busy: 0, permissionBlocked: 0, questionBlocked: 0, totalActive: 0,
    },
    providers: existing?.providers ?? { connected: 0, configured: 0 },
  }
}

/* ------------------------------------------------------------------ */
/*  Controller factory                                                  */
/* ------------------------------------------------------------------ */

export function createFleetController(
  checkHealthFn: (http: ServerConnection.HttpBase) => Promise<ServerHealth>,
  global: { servers: { list: () => ServerConnection.Any[] } },
  getCtxFn: (conn: ServerConnection.Any) => {
    sync: { data: { project: Array<unknown>; provider: unknown } };
    sdk: { protocolKind: () => string | undefined };
  },
): FleetController {
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
  /* --- Refreshing state per key --- */
  const [refreshingKeys, setRefreshingKeys] = createStore<Record<string, boolean>>({})
  const [isRefreshingAll, setIsRefreshingAll] = createStore({ all: false })
  const [lastRefresh, setLastRefresh] = createStore({ at: undefined as number | undefined })

  /* --- Worker pool --- */
  const pool = createWorkerPool(HEALTH_CONCURRENCY)
  onCleanup(() => pool.abort())

  /* --- Track probes for cancellation --- */
  let probeControllers = new Map<ServerConnection.Key, AbortController>()

  /* --- Visibility state --- */
  let visible = true
  let pollTimer: ReturnType<typeof setInterval> | undefined

  function onVisibility() {
    const nowVisible = !document.hidden
    visible = nowVisible
    if (nowVisible) {
      // Tab became visible — refresh immediately
      refreshAll()
    }
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility)
    onCleanup(() => document.removeEventListener("visibilitychange", onVisibility))
  }

  /* --- Polling interval --- */
  function startPolling() {
    stopPolling()
    pollTimer = setInterval(() => {
      if (visible) refreshAll()
    }, POLL_INTERVAL_MS)
  }
  function stopPolling() {
    if (pollTimer !== undefined) {
      clearInterval(pollTimer)
      pollTimer = undefined
    }
  }
  // Start polling on creation
  startPolling()
  onCleanup(() => stopPolling())

  /* --- Cleanup on unmount --- */
  onCleanup(() => {
    for (const ctrl of probeControllers.values()) ctrl.abort()
    probeControllers.clear()
  })

  /* --- Re-sync when server list changes --- */
  const knownKeysRef = { current: new Set<ServerConnection.Key>() }

  createEffect(
    on(serverList, (list) => {
      const newKeys = new Set<ServerConnection.Key>()
      const entries: Array<[string, FleetServerSnapshot]> = []

      for (const conn of list) {
        const key = ServerConnection.key(conn)
        newKeys.add(key)
        entries.push([key as string, buildSnapshot(conn, snapshots[key as string])])
      }

      // Clean up probes for removed servers
      for (const key of knownKeysRef.current) {
        if (!newKeys.has(key)) {
          probeControllers.get(key)?.abort()
          probeControllers.delete(key)
        }
      }
      knownKeysRef.current = newKeys

      setSnapshots(reconcile(Object.fromEntries(entries)))
    }),
  )

  /* --- Reactive sync data watcher: re-reads protocol, projects, providers --- */
  createEffect(() => {
    const list = serverList()
    // Track reactive reads so Solid re-runs when sync data changes
    for (const conn of list) {
      try {
        const ctx = getCtxFn(conn)
        ctx.sdk.protocolKind()
        ctx.sync.data.project
        ctx.sync.data.provider
      } catch { /* skip */ }
    }

    for (const conn of list) {
      const key = ServerConnection.key(conn) as string
      try {
        const ctx = getCtxFn(conn)
        const protocolKind = ctx.sdk.protocolKind()

        const projectArray = ctx.sync.data.project
        const known = Array.isArray(projectArray) ? projectArray.length : 0
        const open = known

        const providerData = ctx.sync.data.provider
        let connectedCount = 0
        let configuredCount = 0
        if (providerData && typeof providerData === "object") {
          const p = providerData as Record<string, unknown>
          if (Array.isArray(p.connected)) connectedCount = p.connected.length
          if (Array.isArray(p.configured)) configuredCount = p.configured.length
          if (configuredCount === 0 && connectedCount > 0) {
            configuredCount = connectedCount
          }
        }

        setSnapshots(key, "protocol", reconcile({
          kind: (protocolKind as "v1" | "v2" | undefined) ?? snapshots[key]?.protocol.kind,
        }))
        setSnapshots(key, "projects", reconcile({ open, known }))
        setSnapshots(key, "providers", reconcile({
          connected: connectedCount,
          configured: configuredCount,
        }))
      } catch { /* skip */ }
    }
  })

  /* --- Sorted view: online first, then name --- */
  const sorted = createMemo(() =>
    Object.values(snapshots).sort((a, b) => {
      const order: Record<string, number> = {
        online: 0, degraded: 1, checking: 2,
        "auth-required": 3, "auth-failed": 3, offline: 4,
      }
      return (order[a.health.state] ?? 5) - (order[b.health.state] ?? 5) || a.name.localeCompare(b.name)
    }),
  )

  /* --- Summary --- */
  const summaryMemo = createMemo(() => {
    const entries = Object.values(snapshots)
    let online = 0, degraded = 0, offline = 0, totalRunningSessions = 0, totalBlockedSessions = 0
    for (const s of entries) {
      if (s.health.state === "online") online++
      else if (s.health.state === "degraded") degraded++
      else if (s.health.state === "offline" || s.health.state === "auth-failed" || s.health.state === "auth-required") offline++
      totalRunningSessions += s.sessions.running
      totalBlockedSessions += s.sessions.permissionBlocked + s.sessions.questionBlocked
    }
    return { online, degraded, offline, totalRunningSessions, totalBlockedSessions, totalServers: entries.length }
  })

  /* --- Single server health probe --- */
  async function probeOne(conn: ServerConnection.Any, key: ServerConnection.Key) {
    probeControllers.get(key)?.abort()
    const abortCtrl = new AbortController()
    probeControllers.set(key, abortCtrl)

    setSnapshots(key as string, "health", { state: "checking" })
    setRefreshingKeys(key as string, true)

    try {
      // Use the injected platform-aware health check function, NOT raw fetch.
      // This respects desktop/SSH/WSL/proxy transport and includes auth headers.
      // Latency is measured as part of the same authenticated request.
      const { health: healthResult, latencyMs } = await healthWithLatency(
        checkHealthFn,
        conn.http,
        abortCtrl.signal,
      )

      if (abortCtrl.signal.aborted) return

      let state: FleetServerSnapshot["health"]["state"] = "online"
      if (!healthResult.healthy) {
        state = healthResult.authFailed
          ? "auth-failed"
          : healthResult.requiresAuth
            ? "auth-required"
            : "offline"
      }

      setSnapshots(key as string, "health", {
        state,
        healthy: healthResult.healthy,
        version: healthResult.version,
        latencyMs: latencyMs ?? undefined,
        checkedAt: Date.now(),
      })
    } catch {
      if (!abortCtrl.signal.aborted) {
        setSnapshots(key as string, "health", { state: "offline", healthy: false, checkedAt: Date.now() })
      }
    } finally {
      setRefreshingKeys(key as string, false)
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

  let _refreshingAll = false

  async function refreshAll() {
    if (!visible || _refreshingAll) return  // no duplicate refreshes
    _refreshingAll = true
    const list = global.servers.list()
    setLastRefresh("at", Date.now())
    setIsRefreshingAll("all", true)

    for (const conn of list) {
      const key = ServerConnection.key(conn)
      setSnapshots(key as string, "health", { state: "checking" })
    }

    const promises = list.map((conn) => {
      const key = ServerConnection.key(conn)
      return pool.enqueue(() => probeOne(conn, key))
    })
    await Promise.allSettled(promises)
    setIsRefreshingAll("all", false)
    _refreshingAll = false
  }

  /* --- Action handlers: wired from FleetPage with real app APIs --- */
  let _openServerFn: ((key: ServerConnection.Key) => void) | undefined
  let _editServerFn: ((key: ServerConnection.Key) => void) | undefined

  function getConnection(key: ServerConnection.Key): ServerConnection.Any | undefined {
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
      return list.filter((s) => s.connectionType === type)
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
          case "updated": return (b.health.checkedAt ?? 0) - (a.health.checkedAt ?? 0)
          default: return 0
        }
      })
      return copy
    },
    refreshOne,
    refreshAll,
    get openHandler(): ((key: ServerConnection.Key) => void) | undefined { return _openServerFn },
    set openHandler(fn: ((key: ServerConnection.Key) => void) | undefined) { _openServerFn = fn },
    get editHandler(): ((key: ServerConnection.Key) => void) | undefined { return _editServerFn },
    set editHandler(fn: ((key: ServerConnection.Key) => void) | undefined) { _editServerFn = fn },
    openServer(key: ServerConnection.Key) {
      if (_openServerFn) _openServerFn(key)
    },
    editServer(key: ServerConnection.Key) {
      if (_editServerFn) _editServerFn(key)
    },
    getConnection,
    lastRefreshTime: () => lastRefresh.at,
    refreshing: () => isRefreshingAll.all,
    refreshingKeys: () => new Set(Object.keys(refreshingKeys).filter((k) => refreshingKeys[k])) as Set<ServerConnection.Key>,
    pollingInterval: () => POLL_INTERVAL_MS,
  }
}
