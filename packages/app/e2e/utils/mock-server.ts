import type { Page, Route } from "@playwright/test"

const emptyList = new Set(["/skill", "/command", "/lsp", "/formatter", "/vcs/status"])
const emptyObject = new Set(["/global/config", "/config", "/provider/auth", "/mcp", "/experimental/resource"])

export interface MockServerConfig {
  serverId?: string
  serverUrl?: string
  name?: string
  protocol?: "v1" | "v2"
  username?: string
  password?: string
  basePath?: string
  directory: string
  project: unknown
  sessions: ({ id: string } & Record<string, unknown>)[] | (() => ({ id: string } & Record<string, unknown>)[])
  agents?: unknown[] | (() => unknown[])
  provider: unknown | (() => unknown)
  integrationMethods?: Record<string, unknown[]>
  onConnectKey?: (input: { integrationID: string; body: unknown }) => void
  onInstanceDispose?: () => void
  onSwitchModel?: (input: { sessionID: string; body: unknown }) => void | Promise<void>
  onSwitchAgent?: (input: { sessionID: string; body: unknown }) => void | Promise<void>
  onPrompt?: (input: { sessionID: string; body: unknown }) => void | Promise<void>
  onInterrupt?: (input: { sessionID: string; body: unknown }) => void | Promise<void>
  onPermissionReply?: (input: { sessionID: string; requestID: string; body: unknown }) => void | Promise<void>
  onQuestionReply?: (input: { sessionID: string; requestID: string; body: unknown }) => void | Promise<void>
  onQuestionReject?: (input: { sessionID: string; requestID: string }) => void | Promise<void>
  onSessionCreate?: (input: { body: unknown }) => unknown
  pageMessages?: (sessionId: string, limit: number, before?: string) => { items: unknown[]; cursor?: string }
  vcsDiff?: unknown[]
  messageDelay?: number
  beforeMessagesResponse?: (input: { sessionID: string; before?: string }) => Promise<void>
  onMessages?: (input: { sessionID: string; before?: string; phase: "start" | "end" }) => void
  message?: (sessionID: string, messageID: string) => unknown
  onMessage?: (input: { sessionID: string; messageID: string }) => void
  events?: () => unknown[]
  eventRetry?: number
  todos?: (sessionID: string) => unknown[]
  permissions?: unknown[] | (() => unknown[])
  questions?: unknown[] | (() => unknown[])
  activeSessions?: () => Record<string, unknown>
  fileList?: (path: string) => unknown | Promise<unknown>
  fileContent?: (path: string) => unknown | Promise<unknown>
  findFiles?: (input: { query: string; dirs?: string; limit?: number }) => unknown
  sessionStatus?: Record<string, unknown> | (() => Record<string, unknown>)
  healthy?: boolean
  healthState?: "READY" | "UNHEALTHY" | "CONNECTING"
  statusOverride?: (path: string, method: string, headers: Record<string, string>) => { status: number; body?: unknown; headers?: Record<string, string> } | undefined
  /** Initial legacy global config (provider map) served by GET /global/config. */
  globalConfig?: Record<string, unknown> | (() => Record<string, unknown>)
  /** Captures POST /global/config mutations (custom provider configuration). */
  onGlobalConfigUpdate?: (config: Record<string, unknown>) => void | Promise<void>
  /** Captures POST /api/integration/:id/connect/key credential submissions. */
  onIntegrationConnectKey?: (input: { integrationID: string; body: unknown }) => void | Promise<void>
}

export async function mockMultiServer(page: Page, configs: MockServerConfig[]) {
  const defaultPort = process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"
  const defaultHost = process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"

  const normalizedConfigs = configs.map((cfg, index) => {
    const port = cfg.serverUrl ? new URL(cfg.serverUrl).port : (index === 0 ? defaultPort : String(Number(defaultPort) + index))
    const serverUrl = cfg.serverUrl ?? `http://${defaultHost}:${port}`
    const serverId = cfg.serverId ?? serverUrl
    return {
      ...cfg,
      serverId,
      serverUrl,
      targetPort: port,
    }
  })

  await page.addInitScript(({ serverList, projectsMap, lastProjectMap }) => {
    if (localStorage.getItem("opencode.global.dat:server.v4")) return
    localStorage.setItem(
      "opencode.global.dat:server.v4",
      JSON.stringify({
        list: serverList,
        projects: projectsMap,
        lastProject: lastProjectMap,
        recentlyClosed: {},
      }),
    )
  }, {
    serverList: normalizedConfigs.map((c) => ({
      type: "http",
      http: {
        id: c.serverId,
        url: c.serverUrl,
        ...(c.username ? { username: c.username } : {}),
        ...(c.password ? { password: c.password } : {}),
      },
    })),
    projectsMap: Object.fromEntries(
      normalizedConfigs.map((c) => [c.serverId, [{ worktree: c.directory, expanded: true }]]),
    ),
    lastProjectMap: Object.fromEntries(normalizedConfigs.map((c) => [c.serverId, c.directory])),
  })

  const cursors = new Map<string, string>()
  let nextCursor = 0

  // Per-server mutable runtime: config store (legacy provider map) and
  // integration credential state so tests can drive custom-provider creation.
  const runtime = new Map<
    string,
    {
      config: Record<string, unknown>
      integrations: Map<string, { connections: unknown[] }>
      createdProviders: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>
    }
  >()
  for (const cfg of normalizedConfigs) {
    const initialConfig =
      typeof cfg.globalConfig === "function" ? cfg.globalConfig() : (cfg.globalConfig ?? {})
    runtime.set(cfg.serverId, { config: initialConfig, integrations: new Map(), createdProviders: [] })
  }

  await page.route("**/*", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const appPort = new URL(
      process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "4173"}`,
    ).port
    const applicationPorts = new Set([appPort, process.env.PLAYWRIGHT_STABILITY_PORT].filter(Boolean))
    const targetPorts = new Set(normalizedConfigs.map((c) => c.targetPort))

    if (!targetPorts.has(url.port) && !applicationPorts.has(url.port)) return route.fallback()

    const rawPath = url.pathname.startsWith("/api/opencode")
      ? url.pathname.slice("/api/opencode".length) || "/"
      : url.pathname

    if (rawPath === "/api/bootstrap") {
      return json(route, {
        backends: normalizedConfigs.map((c) => ({
          id: c.serverId,
          name: c.name ?? "Timeline fixture",
          endpoint: c.serverUrl,
          enabled: true,
          state: c.healthState ?? (c.healthy === false ? "UNHEALTHY" : "READY"),
          protocol: c.protocol ?? "v2",
          health: { healthy: c.healthy ?? true, reachable: c.healthy ?? true },
        })),
        activeBackendId: normalizedConfigs[0]?.serverId,
      })
    }

    const serverIdParam = url.searchParams.get("serverId")
    const config =
      normalizedConfigs.find(
        (c) =>
          c.serverId === serverIdParam ||
          (url.port && c.targetPort === url.port) ||
          (c.serverUrl && url.href.startsWith(c.serverUrl)),
      ) ?? normalizedConfigs[0]!

    let path = rawPath
    if (config.basePath && path.startsWith(config.basePath)) {
      path = path.slice(config.basePath.length) || "/"
    }

    const reqHeaders = request.headers()
    const method = request.method()

    if (config.statusOverride) {
      const override = config.statusOverride(path, method, reqHeaders)
      if (override) {
        return json(route, override.body, override.headers, override.status)
      }
    }

    if (config.password && reqHeaders["authorization"]) {
      const authHeader = reqHeaders["authorization"]
      const expectedAuth = `Basic ${Buffer.from(`${config.username || "opencode"}:${config.password}`).toString("base64")}`
      if (authHeader !== expectedAuth) {
        return json(route, { error: "Unauthorized" }, undefined, 401)
      }
    }

    const healthMatch = path.match(/^\/servers\/([^/]+)\/health$/)
    if (healthMatch) {
      const targetServerId = healthMatch[1]
      const targetCfg = normalizedConfigs.find((c) => c.serverId === targetServerId) ?? config
      const protocol = targetCfg.protocol ?? "v2"
      const isHealthy = targetCfg.healthy !== false && targetCfg.healthState !== "UNHEALTHY"
      if (!isHealthy) {
        return json(
          route,
          {
            server: {
              id: targetCfg.serverId,
              name: targetCfg.name ?? "OpenCode Server",
              endpoint: targetCfg.serverUrl,
              enabled: true,
              state: "UNHEALTHY",
              protocol,
            },
            state: "UNHEALTHY",
            healthy: false,
            authenticated: true,
            reachable: false,
            protocol,
            latencyMs: 999,
            checkedAt: new Date().toISOString(),
          },
          undefined,
          503,
        )
      }
      return json(route, {
        server: {
          id: targetCfg.serverId,
          name: targetCfg.name ?? "OpenCode Server",
          endpoint: targetCfg.serverUrl,
          enabled: true,
          state: "READY",
          protocol,
        },
        state: "READY",
        healthy: true,
        authenticated: true,
        reachable: true,
        protocol,
        latencyMs: 1,
        checkedAt: new Date().toISOString(),
      })
    }

    const currentSessions = () =>
      typeof config.sessions === "function" ? config.sessions() : config.sessions

    const currentAgents = () => {
      const agents = typeof config.agents === "function" ? config.agents() : config.agents
      return agents ?? [{ id: "build", name: "Build", mode: "primary", hidden: false }]
    }

    const staticRoutes: Record<string, unknown> = {
      "/path": {
        state: config.directory,
        config: config.directory,
        worktree: config.directory,
        directory: config.directory,
        home: "C:/OpenCode",
      },
      "/project": [config.project],
      "/project/current": config.project,
      "/agent": currentAgents(),
      "/vcs": { branch: "main", default_branch: "main" },
    }

    if (path === "/global/event" || path === "/event" || path === "/api/event") {
      const events = config.events?.()
      return sse(
        route,
        path === "/api/event"
          ? [{ id: "evt_mock_connected", type: "server.connected", data: {} }, ...(events?.map(currentEvent) ?? [])]
          : [
              ...(path === "/global/event"
                ? [{ payload: { id: "evt_mock_connected", type: "server.connected", properties: {} } }]
                : []),
              ...(events ?? []),
            ],
        config.eventRetry,
      )
    }

    if (path === "/global/health")
      return config.protocol === "v2" ? json(route, {}, undefined, 404) : json(route, { healthy: config.healthy ?? true })
    const rt = runtime.get(config.serverId)!
    const createdProviders = () => rt.createdProviders
    const configProviderMap = (rt.config.provider as Record<string, unknown> | undefined) ?? {}
    const legacyToProvider = (id: string, item: Record<string, unknown>) => {
      const options = (item.options as Record<string, unknown> | undefined) ?? {}
      const modelsMap = (item.models as Record<string, unknown> | undefined) ?? {}
      return {
        id,
        name: typeof item.name === "string" ? item.name : id,
        npm: typeof item.npm === "string" ? item.npm : "@ai-sdk/openai-compatible",
        models: Object.fromEntries(
          Object.entries(modelsMap).map(([mid, model]) => {
            const m = (model as Record<string, unknown>) ?? {}
            return [mid, { id: mid, name: typeof m.name === "string" ? m.name : mid, ...(options.baseURL ? { url: options.baseURL } : {}) }]
          }),
        ),
      }
    }
    const allConfigProviders = () => [
      ...Object.entries(configProviderMap).map(([id, item]) => legacyToProvider(id, item as Record<string, unknown>)),
      ...createdProviders(),
    ]

    if (path === "/global/config" || path === "/api/global/config") {
      if (method === "GET") return json(route, rt.config)
      if (method === "POST" || method === "PATCH" || method === "PUT") {
        const body = request.postDataJSON() as Record<string, unknown> | undefined
        const payload = method === "PATCH" && body && "config" in body ? (body.config as Record<string, unknown>) : body
        Object.assign(rt.config, payload ?? {})
        await config.onGlobalConfigUpdate?.(rt.config)
        return route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({}) })
      }
    }

    if (path === "/api/health" && config.protocol === "v2")
      return json(route, { healthy: config.healthy ?? true, version: "2.0.0", pid: 1 })
    if (path === "/experimental/capabilities") return json(route, { backgroundSubagents: true })
    if (path === "/provider")
      return json(route, typeof config.provider === "function" ? config.provider() : config.provider)
    if (path === "/api/provider") {
      const value = (typeof config.provider === "function" ? config.provider() : config.provider) as {
        all?: Array<{ id: string; name?: string; integrationID?: string }>
      }
      const base = (value.all ?? []).map((p) => ({
        id: p.id,
        name: p.name ?? p.id,
        settings: {},
        ...(typeof p.integrationID === "string" ? { integrationID: p.integrationID } : {}),
      }))
      const merged = new Map(base.map((p) => [p.id, p]))
      for (const p of allConfigProviders()) merged.set(p.id, { id: p.id, name: p.name, settings: {} })
      return json(route, {
        location: location(config),
        data: Array.from(merged.values()),
      })
    }
    if (path === "/api/model") {
      const value = (typeof config.provider === "function" ? config.provider() : config.provider) as {
        all?: Array<{ id: string; name?: string; models?: Record<string, unknown> }>
      }
      const providerModels = new Map<string, Array<Record<string, unknown>>>()
      for (const provider of value.all ?? []) {
        providerModels.set(
          provider.id,
          Object.values(provider.models ?? {}).map((model) => {
            const current = model as Record<string, unknown>
            const id = typeof current.id === "string" ? current.id : "model"
            return {
              id,
              modelID: id,
              providerID: provider.id,
              name: typeof current.name === "string" ? current.name : id,
              family: id,
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              variants: Array.isArray(current.variants)
                ? current.variants.map((v) => (typeof v === "string" ? { id: v } : v))
                : current.variants && typeof current.variants === "object"
                  ? Object.keys(current.variants).map((id) => ({ id }))
                  : [],
              time: (current.time as { released?: number } | undefined) ?? { released: Date.now() },
              cost: current.cost ?? [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
              status: "active",
              enabled: true,
              limit: { context: 200_000, output: 16_000 },
            }
          }),
        )
      }
      for (const provider of allConfigProviders()) {
        const models = Object.values((provider.models ?? {}) as Record<string, unknown>).map((m) => {
          const current = (m as Record<string, unknown>) ?? {}
          const id = typeof current.id === "string" ? current.id : "model"
          return {
            id,
            modelID: id,
            providerID: provider.id,
            name: typeof current.name === "string" ? current.name : id,
            family: id,
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            variants: [],
            time: { released: Date.now() },
            cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
            status: "active",
            enabled: true,
            limit: { context: 200_000, output: 16_000 },
          }
        })
        providerModels.set(provider.id, models)
      }
      return json(route, { location: location(config), data: Array.from(providerModels.values()).flat() })
    }
    if (path === "/api/model/default") {
      const value = (typeof config.provider === "function" ? config.provider() : config.provider) as {
        default?: { providerID?: string; modelID?: string }
      }
      const data = value.default?.providerID && value.default.modelID
        ? { id: value.default.modelID, providerID: value.default.providerID }
        : null
      return json(route, { location: location(config), data })
    }
    if (path === "/api/integration" && method === "GET") {
      const value = (typeof config.provider === "function" ? config.provider() : config.provider) as {
        all?: Array<{ id: string; name?: string }>
        connected?: string[]
      }
      const methods = config.integrationMethods ?? {}
      const ids = new Set([...(value.all ?? []).map((provider) => provider.id), ...Object.keys(methods)])
      const connected = new Set(value.connected ?? [])
      return json(route, {
        location: location(config),
        data: [...ids].map((id) => ({
          id,
          name: value.all?.find((provider) => provider.id === id)?.name ?? id,
          methods: (methods[id] ?? [{ type: "api", label: "API key" }]).map((method) => {
            const item = method as { type?: string; label?: string; id?: string }
            if (item.type === "oauth") return { type: "oauth", id: item.id ?? `${id}-oauth`, label: item.label ?? "OAuth" }
            if (item.type === "env") return { type: "env", names: [] }
            return { type: "key", label: item.label ?? "API key" }
          }),
          connections: connected.has(id) ? [{ type: "credential", id, label: id }] : [],
        })),
      })
    }
    if (path === "/provider/auth") return json(route, config.integrationMethods ?? {})
    const legacyAuth = path.match(/^\/auth\/([^/]+)$/)?.[1]
    if (legacyAuth && method === "PUT") {
      config.onConnectKey?.({ integrationID: legacyAuth, body: request.postDataJSON() })
      return json(route, true)
    }
    if (path === "/instance/dispose" && method === "POST") {
      config.onInstanceDispose?.()
      return json(route, true)
    }
    if (path === "/permission")
      return json(route, typeof config.permissions === "function" ? config.permissions() : (config.permissions ?? []))
    if (path === "/question")
      return json(route, typeof config.questions === "function" ? config.questions() : (config.questions ?? []))
    if (path === "/session/status")
      return json(
        route,
        config.activeSessions
          ? config.activeSessions()
          : typeof config.sessionStatus === "function"
            ? config.sessionStatus()
            : (config.sessionStatus ?? {}),
      )
    if (path === "/vcs/diff" && config.vcsDiff) return json(route, config.vcsDiff)
    if (path === "/file" && config.fileList)
      return json(route, await config.fileList(url.searchParams.get("path") ?? ""))
    if (path === "/file/content" && config.fileContent)
      return json(route, await config.fileContent(url.searchParams.get("path") ?? ""))
    if (path === "/find/file" && config.findFiles)
      return json(
        route,
        await config.findFiles({
          query: url.searchParams.get("query") ?? "",
          dirs: url.searchParams.get("dirs") ?? undefined,
          limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
        }),
      )
    if (path === "/api/reference")
      return json(route, {
        location: {
          directory: config.directory,
          project: { id: (config.project as { id?: string }).id, directory: config.directory },
        },
        data: [],
      })
    if (path === "/api/agent")
      return json(route, {
        location: location(config),
        data: currentAgents(),
      })
    if (path === "/api/command") return json(route, { location: location(config), data: [] })
    if (path === "/api/mcp") return json(route, { location: location(config), data: [] })
    if (path === "/api/mcp/resource")
      return json(route, { location: location(config), data: { resources: [], templates: [] } })
    const integration = path.match(/^\/api\/integration\/([^/]+)$/)?.[1]
    if (integration && method === "GET")
      return json(route, {
        location: location(config),
        data: { id: integration, name: integration, methods: [{ type: "key", label: "API key" }], connections: [] },
      })
    const integrationConnect = path.match(/^\/api\/integration\/([^/]+)\/connect\/key$/)?.[1]
    if (integrationConnect && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown> | undefined
      config.onConnectKey?.({ integrationID: integrationConnect, body })
      await config.onIntegrationConnectKey?.({ integrationID: integrationConnect, body })
      const state = runtime.get(config.serverId)!
      if (!state.integrations.has(integrationConnect)) state.integrations.set(integrationConnect, { connections: [] })
      state.integrations.get(integrationConnect)!.connections.push({ type: "credential", id: integrationConnect, label: integrationConnect })
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    if (path === "/api/project") return json(route, [config.project])
    if (path === "/api/project/current")
      return json(route, { id: (config.project as { id?: string }).id, directory: config.directory })
    if (path.startsWith("/api/project/") && method === "PATCH") return json(route, config.project)
    if (path === "/api/path")
      return json(route, {
        state: config.directory,
        config: config.directory,
        worktree: config.directory,
        directory: config.directory,
        home: "C:/OpenCode",
      })
    if (path === "/api/permission/request")
      return json(route, {
        location: location(config),
        data: (typeof config.permissions === "function" ? config.permissions() : (config.permissions ?? [])).map(
          currentPermission,
        ),
      })
    if (path === "/api/question/request")
      return json(route, {
        location: location(config),
        data: typeof config.questions === "function" ? config.questions() : (config.questions ?? []),
      })
    if (path === "/api/vcs")
      return json(route, { location: location(config), data: { branch: "main", defaultBranch: "main" } })
    if (path === "/api/vcs/status") return json(route, { location: location(config), data: [] })
    if (path === "/api/vcs/diff") return json(route, { location: location(config), data: config.vcsDiff ?? [] })
    if (path === "/api/pty/shells") return json(route, { location: location(config), data: [] })
    if (path === "/pty/shells") return json(route, [])
    if (/^\/api\/pty\/[^/]+\/connect-token$/.test(path))
      return json(route, { location: location(config), data: { ticket: "e2e-ticket", expires_in: 60 } })
    if (emptyObject.has(path)) return json(route, {})
    if (emptyList.has(path)) return json(route, [])

    if (path === "/api/session" && method === "POST") {
      const body = request.postDataJSON()
      const created = config.onSessionCreate?.({ body }) ?? {
        id: `ses_${Date.now()}`,
        projectID: (config.project as { id?: string })?.id ?? "project",
        directory: config.directory,
        title: "New Session",
        time: { created: Date.now(), updated: Date.now() },
      }
      return json(route, { data: currentSession(created as any, config.directory) })
    }

    if (path === "/api/session") {
      const directory = url.searchParams.get("directory")
      const parentID = url.searchParams.get("parentID")
      const limit = Number(url.searchParams.get("limit") ?? 50)
      const offset = Number(url.searchParams.get("cursor") ?? 0)
      const all = currentSessions()
      const sessions = all
        .filter((session) => !directory || session.directory === directory)
        .filter((session) => {
          if (parentID === undefined || parentID === null) return true
          if (parentID === "null" || parentID === "") return session.parentID === undefined || session.parentID === null
          return session.parentID === parentID
        })
        .filter((session) => {
          const search = url.searchParams.get("search")?.toLowerCase()
          return (
            !search ||
            String(session.title ?? "")
              .toLowerCase()
              .includes(search)
          )
        })
      const ordered = url.searchParams.get("order") === "asc" ? sessions.toReversed() : sessions
      const data = ordered.slice(offset, offset + limit)
      const next = offset + limit < ordered.length ? String(offset + limit) : undefined
      return json(route, {
        data: data.map((session) => currentSession(session, config.directory)),
        cursor: { next },
      })
    }
    if (path === "/session" && method === "GET") {
      return json(route, currentSessions())
    }

    if (path === "/api/session/active") {
      const statuses = (config.activeSessions
        ? config.activeSessions()
        : typeof config.sessionStatus === "function"
          ? config.sessionStatus()
          : (config.sessionStatus ?? {})) as Record<string, { type?: string }>
      return json(route, {
        data: Object.fromEntries(
          Object.entries(statuses).flatMap(([id, status]) =>
            status.type === "idle" ? [] : [[id, { type: status.type ?? "running" }]],
          ),
        ),
      })
    }
    if (/^\/api\/session\/[^/]+\/shell$/.test(path) && method === "POST") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    const promptMatch = path.match(/^\/api\/session\/([^/]+)\/prompt$/)
    if (promptMatch && method === "POST") {
      const body = request.postDataJSON() as { id?: string; prompt?: unknown; delivery?: "steer" | "queue" }
      await config.onPrompt?.({ sessionID: promptMatch[1]!, body })
      return json(route, {
        data: {
          admittedSeq: 1,
          id: body.id ?? "e2e-prompt",
          sessionID: promptMatch[1],
          prompt: body.prompt ?? { text: "" },
          delivery: body.delivery ?? "steer",
          timeCreated: Date.now(),
        },
      })
    }
    const switchModelMatch = path.match(/^\/api\/session\/([^/]+)\/model$/)
    if (switchModelMatch && method === "POST") {
      try {
        await config.onSwitchModel?.({ sessionID: switchModelMatch[1]!, body: request.postDataJSON() })
      } catch (error) {
        return json(route, { error: error instanceof Error ? error.message : "model switch failed" }, undefined, 503)
      }
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    const switchAgentMatch = path.match(/^\/api\/session\/([^/]+)\/agent$/)
    if (switchAgentMatch && method === "POST") {
      try {
        await config.onSwitchAgent?.({ sessionID: switchAgentMatch[1]!, body: request.postDataJSON() })
      } catch (error) {
        return json(route, { error: error instanceof Error ? error.message : "agent switch failed" }, undefined, 503)
      }
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    const legacyPromptMatch = path.match(/^\/session\/([^/]+)\/prompt_async$/)
    if (legacyPromptMatch && method === "POST") {
      await config.onPrompt?.({ sessionID: legacyPromptMatch[1]!, body: request.postDataJSON() })
      return json(route, true)
    }

    const questionReplyMatch = path.match(/^\/api\/session\/([^/]+)\/question\/([^/]+)\/(reply|reject)$/)
    if (questionReplyMatch && method === "POST") {
      const [, sessionID, requestID, action] = questionReplyMatch
      if (action === "reply") {
        await config.onQuestionReply?.({ sessionID: sessionID!, requestID: requestID!, body: request.postDataJSON() })
      } else {
        await config.onQuestionReject?.({ sessionID: sessionID!, requestID: requestID! })
      }
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }

    const permReplyMatch = path.match(/^\/api\/session\/([^/]+)\/permission\/([^/]+)\/reply$/)
    if (permReplyMatch && method === "POST") {
      const [, sessionID, requestID] = permReplyMatch
      await config.onPermissionReply?.({ sessionID: sessionID!, requestID: requestID!, body: request.postDataJSON() })
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }

    if (/^\/question\/[^/]+\/(reply|reject)$/.test(path) && method === "POST") {
      return json(route, true)
    }
    if (/^\/session\/[^/]+\/permissions\/[^/]+$/.test(path) && method === "POST") {
      return json(route, true)
    }
    const interruptMatch = path.match(/^\/api\/session\/([^/]+)\/interrupt$/)
    if (interruptMatch && method === "POST") {
      await config.onInterrupt?.({ sessionID: interruptMatch[1]!, body: request.postDataJSON() })
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    const legacyInterruptMatch = path.match(/^\/session\/([^/]+)\/abort$/)
    if (legacyInterruptMatch && method === "POST") {
      await config.onInterrupt?.({ sessionID: legacyInterruptMatch[1]!, body: request.postDataJSON() })
      return json(route, true)
    }
    if (
      /^\/api\/session\/[^/]+\/(archive|rename|revert\/clear|revert\/commit)$/.test(path) &&
      method === "POST"
    ) {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    if (/^\/api\/session\/[^/]+$/.test(path) && method === "DELETE") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } })
    }
    if (path in staticRoutes) return json(route, staticRoutes[path])

    const currentSessionMatch = path.match(/^\/api\/session\/([^/]+)$/)
    if (currentSessionMatch) {
      const session = currentSessions().find((item) => item.id === currentSessionMatch[1])
      if (!session) return json(route, { error: "Session not found" }, undefined, 404)
      return json(route, {
        data: currentSession(session, config.directory),
      })
    }

    const sessionMatch = path.match(/^\/session\/([^/]+)$/)
    if (sessionMatch) {
      const session = currentSessions().find((s) => s.id === sessionMatch[1])
      return json(route, session ?? {})
    }

    const projectMatch = path.match(/^\/project\/([^/]+)$/)
    if (projectMatch) return json(route, config.project)

    const messageMatch = path.match(/^\/session\/([^/]+)\/message\/([^/]+)$/)
    if (messageMatch) {
      config.onMessage?.({ sessionID: messageMatch[1]!, messageID: messageMatch[2]! })
      if (config.messageDelay !== undefined) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const message = config.message?.(messageMatch[1]!, messageMatch[2]!)
      if (message === undefined) return json(route, { error: "Message not found" }, undefined, 404)
      return json(route, message)
    }

    const todoMatch = path.match(/^\/session\/([^/]+)\/todo$/)
    if (todoMatch) return json(route, config.todos?.(todoMatch[1]!) ?? [])

    const childrenMatch = path.match(/^\/session\/([^/]+)\/children$/)
    if (childrenMatch) {
      const pId = childrenMatch[1]
      const children = currentSessions().filter((s) => s.parentID === pId)
      return json(route, children)
    }
    if (/^\/session\/[^/]+\/diff$/.test(path)) return json(route, [])

    const currentMessagesMatch = path.match(/^\/api\/session\/([^/]+)\/message$/)
    if (currentMessagesMatch) {
      const token = url.searchParams.get("cursor") ?? undefined
      const before = token ? cursors.get(token) : undefined
      if (token && !before) return json(route, { error: "Invalid cursor" }, undefined, 400)
      config.onMessages?.({ sessionID: currentMessagesMatch[1]!, before, phase: "start" })
      await config.beforeMessagesResponse?.({ sessionID: currentMessagesMatch[1]!, before })
      if (config.messageDelay !== undefined) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const pageData = config.pageMessages
        ? config.pageMessages(currentMessagesMatch[1]!, Number(url.searchParams.get("limit") ?? 50), before)
        : { items: [] }
      config.onMessages?.({ sessionID: currentMessagesMatch[1]!, before, phase: "end" })
      const cursor = pageData.cursor ? `cursor_${++nextCursor}` : undefined
      if (cursor) cursors.set(cursor, pageData.cursor!)
      return json(route, {
        data: pageData.items.map(currentMessage).reverse(),
        cursor: { next: cursor },
      })
    }

    const messagesMatch = path.match(/^\/session\/([^/]+)\/message$/)
    if (messagesMatch) {
      const token = url.searchParams.get("before") ?? undefined
      const before = token ? cursors.get(token) : undefined
      if (token && !before) return json(route, { error: "Invalid cursor" }, undefined, 400)
      config.onMessages?.({ sessionID: messagesMatch[1]!, before, phase: "start" })
      await config.beforeMessagesResponse?.({ sessionID: messagesMatch[1]!, before })
      if (config.messageDelay !== undefined) await new Promise((resolve) => setTimeout(resolve, config.messageDelay))
      const limit = Number(url.searchParams.get("limit") ?? 80)
      const pageData = config.pageMessages
        ? config.pageMessages(messagesMatch[1]!, limit, before)
        : { items: [] }
      config.onMessages?.({ sessionID: messagesMatch[1]!, before, phase: "end" })
      if (!pageData.cursor) return json(route, pageData.items)
      const cursor = `cursor_${++nextCursor}`
      cursors.set(cursor, pageData.cursor)
      return json(route, pageData.items, { "x-next-cursor": cursor })
    }

    if (targetPorts.has(url.port) && !applicationPorts.has(url.port)) return json(route, {})
    return route.fallback()
  })
}

export async function mockOpenCodeServer(page: Page, config: MockServerConfig) {
  return mockMultiServer(page, [config])
}

function location(config: MockServerConfig) {
  return {
    directory: config.directory,
    project: { id: (config.project as { id?: string }).id, directory: config.directory },
  }
}

function currentPermission(value: unknown) {
  const permission = value as Record<string, unknown>
  if (permission.action) return permission
  const tool = permission.tool as { messageID?: string; callID?: string } | undefined
  return {
    id: permission.id,
    sessionID: permission.sessionID,
    action: permission.permission,
    resources: permission.patterns ?? [],
    save: permission.always,
    metadata: permission.metadata,
    source:
      tool?.messageID && tool.callID ? { type: "tool", messageID: tool.messageID, callID: tool.callID } : undefined,
  }
}

export function currentSession(session: { id: string } & Record<string, unknown>, fallbackDirectory?: string) {
  const time = session.time && typeof session.time === "object" ? session.time : {}
  return {
    id: session.id,
    parentID: session.parentID,
    projectID: session.projectID ?? "project",
    agent: session.agent ?? "build",
    model: session.model ?? { id: "mock-model", providerID: "mock-provider" },
    cost: session.cost ?? 0,
    tokens: session.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: {
      created: "created" in time && typeof time.created === "number" ? time.created : 0,
      updated: "updated" in time && typeof time.updated === "number" ? time.updated : 0,
      ...(session.time && typeof session.time === "object" && "archived" in session.time
        ? { archived: session.time.archived }
        : {}),
    },
    title: session.title ?? session.id,
    location: {
      directory: typeof session.directory === "string" ? session.directory : fallbackDirectory,
      ...(typeof session.workspaceID === "string" ? { workspaceID: session.workspaceID } : {}),
    },
    subpath: session.path,
    revert: session.revert,
  }
}

export function currentMessage(value: unknown) {
  const item = value as {
    info: Record<string, unknown> & { id: string; role: "user" | "assistant"; time: { created: number } }
    parts: Array<Record<string, unknown> & { type: string }>
  }
  if (item.info.role === "user") {
    return {
      id: item.info.id,
      type: "user",
      time: item.info.time,
      text: item.parts
        .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
        .join("\n"),
    }
  }
  return {
    id: item.info.id,
    type: "assistant",
    time: item.info.time,
    agent: item.info.agent ?? "build",
    model: { id: item.info.modelID ?? "model", providerID: item.info.providerID ?? "provider" },
    cost: item.info.cost,
    tokens: item.info.tokens,
    error: item.info.error,
    content: item.parts.flatMap<unknown>((part) => {
      if (part.type === "text" || part.type === "reasoning") return [{ type: part.type, text: part.text ?? "" }]
      if (part.type !== "tool") return []
      const state = part.state as Record<string, unknown>
      return [
        {
          type: "tool",
          id: part.id,
          name: part.tool,
          time: state.time ?? { created: item.info.time.created },
          state:
            state.status === "pending"
              ? { status: "streaming", input: state.raw ?? JSON.stringify(state.input ?? {}) }
              : state.status === "completed"
                ? {
                    status: "completed",
                    input: state.input ?? {},
                    structured: state.metadata ?? {},
                    content: [{ type: "text", text: state.output ?? "" }],
                  }
                : state.status === "error"
                  ? {
                      status: "error",
                      input: state.input ?? {},
                      structured: state.metadata ?? {},
                      content: [],
                      error: { type: "ToolError", message: state.error ?? "Tool failed" },
                    }
                  : { status: "running", input: state.input ?? {}, structured: state.metadata ?? {}, content: [] },
        },
      ]
    }),
  }
}

function json(route: Route, body: unknown, headers?: Record<string, string>, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "x-next-cursor",
      ...headers,
    },
    body: JSON.stringify(body ?? null),
  })
}

function sse(route: Route, events?: unknown[], retry?: number) {
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body: `${retry === undefined ? "" : `retry: ${retry}\n\n`}${events?.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") || ": ok\n\n"}`,
  })
}

function currentEvent(input: unknown) {
  if (!input || typeof input !== "object" || !("payload" in input)) return input
  const envelope = input as { directory?: string; payload?: unknown }
  if (!envelope.payload || typeof envelope.payload !== "object") return input
  const payload = envelope.payload as { id?: string; type?: string; properties?: unknown }
  if (!payload.type) return input
  return {
    id: payload.id ?? `evt_mock_${Date.now()}`,
    created: Date.now(),
    type: payload.type,
    data: payload.properties ?? {},
    location: envelope.directory && envelope.directory !== "global" ? { directory: envelope.directory } : undefined,
  }
}
