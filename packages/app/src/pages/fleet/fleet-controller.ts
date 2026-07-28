
import { createStore, reconcile } from "solid-js/store"
import { createMemo, createEffect, onCleanup, on } from "solid-js"
import type { ServerConnection } from "@/context/server"
import type { ServerHealth } from "@/utils/server-health"
import { checkServerHealth } from "@/utils/server-health"
import type { FleetController, FleetServerSnapshot, FleetConnectionType } from "./fleet-types"
import { HEALTH_CONCURRENCY, HEALTH_PROBE_TIMEOUT_MS, POLL_INTERVAL_MS, normalizeConnectionType } from "./fleet-types"

/* ------------------------------------------------------------------ */
/*  Worker pool — exactly HEALTH_CONCURRENCY persistent workers        */
/*  No recursive spawning. Rejects queued promises on abort.           */
/* ------------------------------------------------------------------ */

function createWorkerPool(concurrency: number) {
  const queue: Array<() => Promise<unknown>> = []
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
      queue.push(async () => {
        try { resolve(await task()) } catch (e) { reject(e) }
      })
      notify()
    })
  }

  function abort() {
    abortController.abort()
    // Wake all sleepers so they exit their loops
    pendingResolvers.splice(0).forEach(r => r())
  }

  return { enqueue, abort, get pending() { return queue.length } }
}

/* ------------------------------------------------------------------ */
/*  Uncached latency probe — a simple HEAD round-trip timing           */
/* ------------------------------------------------------------------ */

async function probeLatency(
  url: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<number | null> {
  const controller = new AbortController()
  const mergedSignal = AbortSignal.any ? AbortSignal.any([signal, controller.signal]) : signal

  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const start = performance.now()
    // Normalize URL: strip trailing slash, build /health path
    const base = url.replace(/\/+$/, "")
    const res = await fetch(`${base}/health`, {
      method: "HEAD",
      signal: mergedSignal,
      cache: "no-store",
      // Important: no credentials/headers here — this is just timing
      // The real health check uses checkServerHealth which handles auth
    })
    return Math.round(performance.now() - start)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ */
/*  Snapshot builder                                                    */
/* ------------------------------------------------------------------ */

function buildSnapshot(
  conn: ServerConnection.Any,
  existing: FleetServerSnapshot | undefined,
  projectsData: { open: number; known: number } | undefined,
  sessionsData: FleetServerSnapshot["sessions"] | undefined,
  providersData: { connected: number; configured: number } | undefined,
  protocolKind: "v1" | "v2" | undefined,
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
    protocol: { kind: protocolKind ?? existing?.protocol.kind },
    projects: projectsData ?? existing?.projects ?? { open: 0, known: 0 },
    sessions: sessionsData ?? existing?.sessions ?? {
      running: 0, busy: 0, permissionBlocked: 0, questionBlocked: 0, totalActive: 0,
    },
    providers: providersData ?? existing?.providers ?? { connected: 0, configured: 0 },
  }
}

/* ------------------------------------------------------------------ */
/*  Controller factory                                                  */
/* ------------------------------------------------------------------ */

export function createFleetController(
  checkHealthFn: (http: ServerConnection.HttpBase) => Promise<ServerHealth>,
  global: { servers: { list: () => ServerConnection.Any[] } },
  getCtxFn: (conn: ServerConnection.Any) => {
    sync: { data: { project: unknown[]; provider: unknown } };
    sdk: { protocolKind: () => "v1" | "v2" };
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
    if (nowVisible && !visible) {
      // Tab became visible — refresh immediately
      refreshAll()
    }
    visible = nowVisible
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
        // Try to get real data from server context
        let projectsData: { open: number; known: number } | undefined
        let sessionsData: FleetServerSnapshot["sessions"] | undefined
        let providersData: { connected: number; configured: number } | undefined
        let protocolKind: "v1" | "v2" | undefined

        try {
          const ctx = getCtxFn(conn)
          const sync = ctx.sync
          protocolKind = ctx.sdk.protocolKind()
          if (sync.data.project) {
            projectsData = {
              open: sync.data.project.length,
              known: sync.data.project.length,
            }
          }
          if (sync.data.provider) {
            const p = sync.data.provider as { connected?: unknown[]; configured?: unknown }
            providersData = {
              connected: Array.isArray(p.connected) ? p.connected.length : 0,
              configured: p.configured ? 1 : 0,
            }
          }
        } catch {
          // Context not available yet — use existing or defaults
        }

        entries.push([key as string, buildSnapshot(conn, snapshots[key as string], projectsData, sessionsData, providersData, protocolKind)])
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
      // Run the full health check and latency probe simultaneously
      const [healthResult, latencyMs] = await Promise.all([
        checkServerHealth(conn.http, globalThis.fetch, { timeoutMs: HEALTH_PROBE_TIMEOUT_MS }),
        probeLatency(conn.http.url, abortCtrl.signal, HEALTH_PROBE_TIMEOUT_MS),
      ])

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

  async function refreshAll() {
    if (!visible) return  // don't mark servers as checking when hidden
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
  }

  /* --- Server actions: call existing app APIs directly --- */
  function openServer(key: ServerConnection.Key) {
    // Dispatch a custom event that the layout layer can pick up
    window.dispatchEvent(new CustomEvent("opencode:select-server", { detail: { key } }))
  }

  function editServer(_key: ServerConnection.Key) {
    window.dispatchEvent(new CustomEvent("opencode:navigate", { detail: { path: "/settings", tab: "servers" } }))
  }

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
        }
      })
      return copy
    },
    refreshOne,
    refreshAll,
    openServer,
    editServer,
    getConnection,
    lastRefreshTime: () => lastRefresh.at,
    refreshing: () => isRefreshingAll.all,
    refreshingKeys: () => new Set(Object.keys(refreshingKeys).filter((k) => refreshingKeys[k])) as Set<ServerConnection.Key>,
    pollingInterval: () => POLL_INTERVAL_MS,
  }
}
