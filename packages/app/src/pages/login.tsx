import { createSignal, createMemo, For, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Icon } from "@opencode-ai/ui/icon"
import { Splash } from "@opencode-ai/ui/logo"
import { useServer, ServerConnection, serverName, normalizeServerUrl } from "@/context/server"
import { useGlobal } from "@/context/global"
import { useCheckServerHealth, type ServerHealth } from "@/utils/server-health"
import { showToast } from "@/utils/toast"

export function LoginPage() {
  const navigate = useNavigate()
  const server = useServer()
  const global = useGlobal()
  const checkHealth = useCheckServerHealth()

  // State for password prompt modal
  const [selectedServer, setSelectedServer] = createSignal<ServerConnection.Any | null>(null)
  const [password, setPassword] = createSignal("")
  const [username, setUsername] = createSignal("opencode")
  const [showPassword, setShowPassword] = createSignal(false)
  const [isVerifying, setIsVerifying] = createSignal(false)
  const [authError, setAuthError] = createSignal("")

  // State for adding a new server inline
  const [showAddServer, setShowAddServer] = createSignal(false)
  const [newServerUrl, setNewServerUrl] = createSignal("")
  const [newServerName, setNewServerName] = createSignal("")
  const [newServerUsername, setNewServerUsername] = createSignal("opencode")
  const [newServerPassword, setNewServerPassword] = createSignal("")
  const [addError, setAddError] = createSignal("")
  const [isAdding, setIsAdding] = createSignal(false)

  // Search & Filter state
  const [searchQuery, setSearchQuery] = createSignal("")
  const [statusFilter, setStatusFilter] = createSignal<"all" | "online" | "auth" | "offline">("all")

  const serverList = createMemo(() => global.servers.list())
  const healthStatus = () => global.servers.health

  // Filtered servers computation
  const filteredServers = createMemo(() => {
    const query = searchQuery().toLowerCase().trim()
    const filter = statusFilter()
    const list = serverList()

    return list.filter((conn) => {
      const name = serverName(conn).toLowerCase()
      const url = (conn.type === "http" ? conn.http.url : "").toLowerCase()
      const matchesQuery = !query || name.includes(query) || url.includes(query)

      if (!matchesQuery) return false

      const key = ServerConnection.key(conn)
      const status: ServerHealth | undefined = healthStatus()[key]
      const isOnline = status?.healthy === true
      const isAuthNeeded = status?.requiresAuth === true || (conn.type === "http" && Boolean(conn.http.password))

      if (filter === "online") return isOnline
      if (filter === "auth") return !isOnline && isAuthNeeded
      if (filter === "offline") return !isOnline && !isAuthNeeded
      return true
    })
  })

  // Server metrics for header cards
  const metrics = createMemo(() => {
    const list = serverList()
    let online = 0
    let auth = 0
    let offline = 0

    for (const conn of list) {
      const key = ServerConnection.key(conn)
      const status: ServerHealth | undefined = healthStatus()[key]
      if (status?.healthy === true) {
        online++
      } else if (status?.requiresAuth === true || (conn.type === "http" && Boolean(conn.http.password))) {
        auth++
      } else {
        offline++
      }
    }

    return { total: list.length, online, auth, offline }
  })

  // Handle server selection & direct connect
  const handleServerClick = async (conn: ServerConnection.Any) => {
    const key = ServerConnection.key(conn)
    const status: ServerHealth | undefined = healthStatus()[key]

    if (
      status?.requiresAuth ||
      status?.authFailed ||
      (conn.type === "http" && conn.http.password === undefined && status?.healthy === false)
    ) {
      setSelectedServer(conn)
      if (conn.type === "http") {
        setUsername(conn.http.username || "opencode")
        setPassword(conn.http.password || "")
      }
      setAuthError("")
      return
    }

    await loginToHome(conn)
  }

  const loginToHome = async (conn: ServerConnection.Any, updatedPassword?: string, updatedUsername?: string) => {
    const key = ServerConnection.key(conn)

    if (conn.type === "http" && (updatedPassword !== undefined || updatedUsername !== undefined)) {
      server.add({
        ...conn,
        http: {
          ...conn.http,
          username: updatedUsername ?? conn.http.username ?? "opencode",
          password: updatedPassword ?? conn.http.password,
        },
      })
    }

    server.setActive(key)
    showToast({
      variant: "success",
      title: "Connected to Server",
      description: `Logged into NewHome on ${serverName(conn)}`,
    })
    navigate("/")
  }

  const submitPasswordAuth = async (e: Event) => {
    e.preventDefault()
    const conn = selectedServer()
    if (!conn) return

    setIsVerifying(true)
    setAuthError("")

    try {
      if (conn.type === "http") {
        const httpBase = {
          url: conn.http.url,
          username: username().trim() || "opencode",
          password: password(),
        }
        const health = await checkHealth(httpBase)

        if (health.healthy || !health.requiresAuth) {
          await loginToHome(conn, password(), username().trim() || "opencode")
          setSelectedServer(null)
        } else {
          setAuthError(health.authFailed ? "Invalid password. Check credentials." : "Authentication required.")
        }
      } else {
        await loginToHome(conn)
        setSelectedServer(null)
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Failed to verify server authentication.")
    } finally {
      setIsVerifying(false)
    }
  }

  const handleAddServerSubmit = async (e: Event) => {
    e.preventDefault()
    const rawUrl = newServerUrl().trim()
    if (!rawUrl) return

    const normalized = normalizeServerUrl(rawUrl)
    if (!normalized) {
      setAddError("Invalid server URL format.")
      return
    }

    setIsAdding(true)
    setAddError("")

    try {
      const httpBase = {
        url: normalized,
        username: newServerUsername().trim() || "opencode",
        password: newServerPassword(),
      }
      const health = await checkHealth(httpBase)

      if (!health.healthy && health.requiresAuth && !newServerPassword()) {
        setAddError("Server requires password access.")
        setIsAdding(false)
        return
      }

      if (!health.healthy && health.authFailed) {
        setAddError("Authentication failed: Incorrect password.")
        setIsAdding(false)
        return
      }

      const newConn: ServerConnection.Http = {
        type: "http",
        displayName: newServerName().trim() || undefined,
        http: httpBase,
      }

      server.add(newConn)
      setShowAddServer(false)
      setNewServerUrl("")
      setNewServerName("")
      setNewServerPassword("")
      showToast({
        variant: "success",
        title: "Server Added",
        description: `Added ${serverName(newConn)}`,
      })
      await loginToHome(newConn)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to connect to specified server.")
    } finally {
      setIsAdding(false)
    }
  }

  const removeServer = (e: MouseEvent, key: ServerConnection.Key) => {
    e.stopPropagation()
    server.remove(key)
    showToast({
      variant: "success",
      title: "Server Removed",
      description: "Server endpoint removed.",
    })
  }

  return (
    <div class="min-h-screen w-full bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-indigo-500 selection:text-white font-sans antialiased overflow-x-hidden">
      {/* Dynamic Background Effects */}
      <div class="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div class="absolute -top-32 -left-32 sm:-top-40 sm:-left-40 w-72 sm:w-96 h-72 sm:h-96 bg-indigo-600/20 rounded-full blur-3xl animate-pulse" />
        <div class="absolute top-1/3 -right-32 sm:-right-40 w-72 sm:w-96 h-72 sm:h-96 bg-purple-600/15 rounded-full blur-3xl" />
        <div class="absolute -bottom-32 left-1/4 w-72 sm:w-96 h-72 sm:h-96 bg-cyan-600/20 rounded-full blur-3xl" />
      </div>

      {/* Responsive Header */}
      <header class="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 flex items-center justify-between border-b border-slate-800/60 backdrop-blur-xl">
        <div class="flex items-center gap-3">
          <div class="p-2 sm:p-2.5 rounded-xl bg-gradient-to-tr from-indigo-500 via-indigo-600 to-purple-600 shadow-lg shadow-indigo-500/25">
            <Splash class="w-6 h-6 sm:w-7 sm:h-7 text-white" />
          </div>
          <div>
            <h1 class="text-lg sm:text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              OpenCode Hub
            </h1>
            <p class="text-[11px] sm:text-xs text-slate-400 font-medium hidden sm:block">
              Server Login & Gateway
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setShowAddServer(!showAddServer())}
            class="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 text-xs font-semibold rounded-lg bg-indigo-600/90 hover:bg-indigo-500 text-white transition-all duration-200 shadow-md shadow-indigo-950/50 hover:shadow-indigo-500/20 active:scale-95 min-h-[38px]"
          >
            <Icon name="plus-small" class="w-4 h-4" />
            <span class="whitespace-nowrap">Add Server</span>
          </button>
        </div>
      </header>

      {/* Main Content Body */}
      <main class="relative z-10 flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 flex flex-col justify-start sm:justify-center">
        {/* Hero Title & Metrics */}
        <div class="text-center max-w-3xl mx-auto mb-8 sm:mb-10">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-950/80 border border-indigo-700/50 text-indigo-300 text-[11px] sm:text-xs font-medium mb-3 sm:mb-4 shadow-inner">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            Active Multi-Server Portal
          </div>
          <h2 class="text-2xl sm:text-4xl font-black text-white tracking-tight leading-tight">
            Select an Active Server to Login
          </h2>
          <p class="mt-2 sm:mt-3 text-xs sm:text-sm text-slate-400 max-w-xl mx-auto">
            Choose your target server endpoint to authenticate and enter its <span class="text-indigo-300 font-semibold">NewHome</span> environment.
          </p>

          {/* Quick Metrics Bar */}
          <div class="mt-6 grid grid-cols-3 gap-2 sm:gap-4 max-w-md mx-auto">
            <div class="p-2.5 sm:p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 backdrop-blur-md">
              <div class="text-base sm:text-xl font-bold text-white">{metrics().total}</div>
              <div class="text-[10px] sm:text-xs text-slate-400 font-medium">Total Servers</div>
            </div>
            <div class="p-2.5 sm:p-3 rounded-xl bg-slate-900/60 border border-emerald-900/40 backdrop-blur-md">
              <div class="text-base sm:text-xl font-bold text-emerald-400">{metrics().online}</div>
              <div class="text-[10px] sm:text-xs text-emerald-400/80 font-medium">Online</div>
            </div>
            <div class="p-2.5 sm:p-3 rounded-xl bg-slate-900/60 border border-amber-900/40 backdrop-blur-md">
              <div class="text-base sm:text-xl font-bold text-amber-400">{metrics().auth}</div>
              <div class="text-[10px] sm:text-xs text-amber-400/80 font-medium">Protected</div>
            </div>
          </div>
        </div>

        {/* Inline Add Server Card */}
        <Show when={showAddServer()}>
          <div class="max-w-xl mx-auto w-full mb-8 sm:mb-10 bg-slate-900/95 border border-indigo-500/40 rounded-2xl p-5 sm:p-6 shadow-2xl backdrop-blur-2xl transition-all">
            <div class="flex items-center justify-between mb-4 border-b border-slate-800/80 pb-3">
              <h3 class="text-sm sm:text-base font-bold text-white flex items-center gap-2">
                <Icon name="plus-small" class="w-5 h-5 text-indigo-400" />
                Connect New Server Endpoint
              </h3>
              <button
                onClick={() => setShowAddServer(false)}
                class="text-slate-400 hover:text-slate-200 text-sm p-1 rounded-lg hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddServerSubmit} class="flex flex-col gap-4">
              <div>
                <label class="block text-xs font-medium text-slate-300 mb-1.5">Server URL *</label>
                <input
                  type="text"
                  placeholder="e.g. http://192.168.1.50:4096"
                  value={newServerUrl()}
                  onInput={(e) => setNewServerUrl(e.currentTarget.value)}
                  class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-medium text-slate-300 mb-1.5">Display Name (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. GPU Dev Cluster"
                    value={newServerName()}
                    onInput={(e) => setNewServerName(e.currentTarget.value)}
                    class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-slate-300 mb-1.5">Username</label>
                  <input
                    type="text"
                    value={newServerUsername()}
                    onInput={(e) => setNewServerUsername(e.currentTarget.value)}
                    class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label class="block text-xs font-medium text-slate-300 mb-1.5">Password Access (If Enabled)</label>
                <input
                  type="password"
                  placeholder="Enter server password"
                  value={newServerPassword()}
                  onInput={(e) => setNewServerPassword(e.currentTarget.value)}
                  class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <Show when={addError()}>
                <div class="text-xs text-rose-400 bg-rose-950/50 border border-rose-800/60 p-3 rounded-xl font-medium">
                  {addError()}
                </div>
              </Show>

              <div class="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddServer(false)}
                  class="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white rounded-xl transition-colors min-h-[38px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAdding()}
                  class="px-5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl transition-all shadow-md shadow-indigo-900/40 min-h-[38px]"
                >
                  {isAdding() ? "Verifying..." : "Add & Connect"}
                </button>
              </div>
            </form>
          </div>
        </Show>

        {/* Search & Filter Controls */}
        <div class="max-w-6xl mx-auto w-full mb-6 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div class="relative flex-1">
            <input
              type="text"
              placeholder="Search active servers by name or URL..."
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              class="w-full pl-9 pr-4 py-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs sm:text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-all backdrop-blur-md"
            />
            <span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">🔍</span>
          </div>

          <div class="flex items-center gap-1 bg-slate-900/80 border border-slate-800 p-1 rounded-xl backdrop-blur-md overflow-x-auto">
            <button
              onClick={() => setStatusFilter("all")}
              class={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter() === "all" ? "bg-indigo-600 text-white font-semibold" : "text-slate-400 hover:text-white"
              }`}
            >
              All ({serverList().length})
            </button>
            <button
              onClick={() => setStatusFilter("online")}
              class={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter() === "online" ? "bg-indigo-600 text-white font-semibold" : "text-slate-400 hover:text-white"
              }`}
            >
              Online ({metrics().online})
            </button>
            <button
              onClick={() => setStatusFilter("auth")}
              class={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter() === "auth" ? "bg-indigo-600 text-white font-semibold" : "text-slate-400 hover:text-white"
              }`}
            >
              Protected ({metrics().auth})
            </button>
          </div>
        </div>

        {/* Server Cards Grid */}
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 max-w-6xl mx-auto w-full">
          <For each={filteredServers()}>
            {(conn) => {
              const key = ServerConnection.key(conn)
              const status: ServerHealth | undefined = healthStatus()[key]
              const isActive = () => server.key === key

              const isHealthy = () => status?.healthy === true
              const requiresAuth = () => status?.requiresAuth === true || (conn.type === "http" && Boolean(conn.http.password))

              return (
                <div
                  onClick={() => void handleServerClick(conn)}
                  class={`
                    group relative flex flex-col justify-between p-5 sm:p-6 rounded-2xl border transition-all duration-300 cursor-pointer overflow-hidden backdrop-blur-xl
                    ${
                      isActive()
                        ? "bg-slate-900/95 border-indigo-500/80 shadow-2xl shadow-indigo-500/15 ring-1 ring-indigo-500/40"
                        : "bg-slate-900/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900/90 hover:shadow-xl hover:-translate-y-0.5"
                    }
                  `}
                >
                  {/* Card Header & Status */}
                  <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center gap-2">
                      <Show when={isHealthy()}>
                        <span class="relative flex h-2.5 w-2.5">
                          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                        </span>
                        <span class="text-[11px] font-semibold text-emerald-400">Online</span>
                      </Show>

                      <Show when={!isHealthy() && requiresAuth()}>
                        <span class="relative flex h-2.5 w-2.5">
                          <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
                        </span>
                        <span class="text-[11px] font-semibold text-amber-400">Password Required</span>
                      </Show>

                      <Show when={!isHealthy() && !requiresAuth()}>
                        <span class="relative flex h-2.5 w-2.5">
                          <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
                        </span>
                        <span class="text-[11px] font-semibold text-rose-400">Offline / Unreachable</span>
                      </Show>
                    </div>

                    <div class="flex items-center gap-2">
                      <Show when={isActive()}>
                        <span class="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-bold border border-indigo-500/40">
                          Active
                        </span>
                      </Show>

                      <button
                        onClick={(e) => removeServer(e, key)}
                        title="Remove Server"
                        class="opacity-100 sm:opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-400 transition-all rounded-md hover:bg-slate-800"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  {/* Server Details */}
                  <div class="mb-5 sm:mb-6">
                    <h3 class="text-base sm:text-lg font-bold text-white group-hover:text-indigo-300 transition-colors truncate">
                      {serverName(conn)}
                    </h3>
                    <p class="text-xs text-slate-400 font-mono mt-1 truncate">
                      {conn.type === "http" ? conn.http.url : "Local Sidecar Proxy"}
                    </p>
                  </div>

                  {/* Card Footer & Connect Action */}
                  <div class="pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs">
                    <span class="text-slate-400 font-medium capitalize flex items-center gap-1.5">
                      <span class="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                      {conn.type}
                    </span>

                    <button
                      class={`
                        px-3.5 py-1.5 rounded-xl font-semibold text-xs transition-all flex items-center gap-1.5 min-h-[34px]
                        ${
                          requiresAuth()
                            ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 group-hover:bg-amber-500 group-hover:text-slate-950 font-bold"
                            : "bg-indigo-600/90 text-white group-hover:bg-indigo-500 shadow-md shadow-indigo-950/40"
                        }
                      `}
                    >
                      <Show when={requiresAuth()}>🔒</Show>
                      <span>{requiresAuth() ? "Login" : "Launch NewHome →"}</span>
                    </button>
                  </div>
                </div>
              )
            }}
          </For>
        </div>

        {/* Empty State */}
        <Show when={filteredServers().length === 0}>
          <div class="text-center py-16 px-4 max-w-md mx-auto">
            <div class="text-3xl mb-3">📡</div>
            <h3 class="text-base font-bold text-white">No Servers Found</h3>
            <p class="text-xs text-slate-400 mt-1">
              No active servers match your search criteria. Add a new server endpoint or adjust filters.
            </p>
          </div>
        </Show>
      </main>

      {/* Footer */}
      <footer class="relative z-10 w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 text-center text-[11px] sm:text-xs text-slate-400 border-t border-slate-800/60">
        OpenCode Web UI • Multi-Server Login Gateway
      </footer>

      {/* Password Prompt Drawer / Modal */}
      <Show when={selectedServer()}>
        {(targetConn) => (
          <div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/85 backdrop-blur-md animate-fadeIn">
            <div class="w-full max-w-md bg-slate-900 border-t sm:border border-indigo-500/40 rounded-t-3xl sm:rounded-2xl p-6 shadow-2xl text-slate-100 max-h-[90vh] overflow-y-auto">
              <div class="flex items-center justify-between mb-4 border-b border-slate-800 pb-3">
                <div class="flex items-center gap-3">
                  <span class="text-2xl">🔒</span>
                  <div>
                    <h3 class="text-base font-bold text-white">Server Password Access</h3>
                    <p class="text-xs text-slate-400 font-mono">{serverName(targetConn())}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedServer(null)}
                  class="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={submitPasswordAuth} class="flex flex-col gap-4">
                <div>
                  <label class="block text-xs font-medium text-slate-300 mb-1.5">Username</label>
                  <input
                    type="text"
                    value={username()}
                    onInput={(e) => setUsername(e.currentTarget.value)}
                    class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>

                <div>
                  <label class="block text-xs font-medium text-slate-300 mb-1.5">Server Password</label>
                  <div class="relative">
                    <input
                      type={showPassword() ? "text" : "password"}
                      placeholder="Enter server password"
                      value={password()}
                      onInput={(e) => setPassword(e.currentTarget.value)}
                      class="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white pr-12 focus:outline-none focus:border-indigo-500"
                      required
                      autofocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword())}
                      class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-xs px-2 py-1"
                    >
                      {showPassword() ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>

                <Show when={authError()}>
                  <div class="text-xs text-rose-400 bg-rose-950/50 border border-rose-800/60 p-3 rounded-xl font-medium">
                    {authError()}
                  </div>
                </Show>

                <div class="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setSelectedServer(null)}
                    class="px-4 py-2.5 text-xs font-medium text-slate-400 hover:text-white rounded-xl transition-colors min-h-[40px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isVerifying()}
                    class="px-5 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-xl transition-all shadow-md shadow-indigo-950/50 min-h-[40px]"
                  >
                    {isVerifying() ? "Authenticating..." : "Login to NewHome"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}
