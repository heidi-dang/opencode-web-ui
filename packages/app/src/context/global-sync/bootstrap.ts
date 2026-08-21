import type {
  Config,
  OpencodeClient,
  Path,
  Project,
  ProviderAuthResponse,
  QuestionRequest,
  ReferenceInfo,
  Session,
} from "@opencode-ai/sdk/v2/client"
import type {
  AgentListInput,
  AgentListOutput,
  CatalogApi,
  CommandInfo,
  CommandListInput,
  CommandListOutput,
  ModelDefaultOutput,
  ProjectCurrentInput,
  ProjectCurrentOutput,
  ReferenceListInput,
  ReferenceListOutput,
  SessionApi,
} from "@opencode-ai/client/promise"
import { showToast } from "@/utils/toast"
import { getFilename } from "@opencode-ai/core/util/path"
import { retry } from "@opencode-ai/core/util/retry"
import { batch } from "solid-js"
import { produce, reconcile, type SetStoreFunction, type Store } from "solid-js/store"
import type { State, VcsCache } from "./types"
import type { ServerSession } from "../server-session"
import {
  cmp,
  normalizeAgentList,
  normalizePermissionRequest,
  normalizeProjectInfo,
  normalizeProviderList,
} from "./utils"
import { formatServerError } from "@/utils/server-errors"
import { clientDiagnostics } from "@/utils/client-diagnostics"
import { ClientError } from "@opencode-ai/client"
import { QueryClient, queryOptions } from "@tanstack/solid-query"
import { loadMcpQuery, loadMcpResourcesQuery } from "../server-sync"
import { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import { ScopedKey, type ServerScope } from "@/utils/server-scope"
import { normalizeSessionInfo } from "@/utils/session"
import type { ServerProtocol } from "@/utils/server-protocol"
import type { ServerApi } from "@/utils/server"
import type { ProviderQueryStatus } from "@/hooks/provider-catalog"
import { normalizeArrayResponse, normalizeProjectListResponse } from "./response-normalizers"

type GlobalStore = {
  ready: boolean
  path: Path
  project: Project[]
  provider: NormalizedProviderListResponse
  provider_status: ProviderQueryStatus
  provider_error?: unknown
  provider_auth: ProviderAuthResponse
  config: Config
  reload: undefined | "pending" | "complete"
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    const timer = setTimeout(finish, 50)
    if (typeof requestAnimationFrame !== "function") return
    requestAnimationFrame(() => {
      setTimeout(() => {
        clearTimeout(timer)
        finish()
      }, 0)
    })
  })
}

function errors(list: PromiseSettledResult<unknown>[]) {
  return list
    .filter((item): item is PromiseRejectedResult => item.status === "rejected")
    .map((item) => item.reason)
    .filter((reason) => !(reason instanceof ClientError && reason.reason === "UnsupportedContentType"))
}

const providerRev = new Map<string, number>()

export function clearProviderRev(scope: ServerScope, directory: string) {
  providerRev.delete(ScopedKey.from(scope, directory))
}

function runAll(list: Array<() => Promise<unknown>>) {
  return Promise.allSettled(list.map((item) => item()))
}

function showErrors(input: {
  errors: unknown[]
  title: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
}) {
  if (input.errors.length === 0) return
  const message = formatServerError(input.errors[0], input.translate)
  const more = input.errors.length > 1 ? input.formatMoreCount(input.errors.length - 1) : ""
  showToast({
    variant: "error",
    title: input.title,
    description: message + more,
  })
}

export const loadGlobalConfigQuery = (scope: ServerScope, sdk: OpencodeClient, protocol?: Promise<ServerProtocol>) =>
  queryOptions({
    queryKey: [scope, "config"],
    queryFn: async () => retry(() => sdk.global.config.get().then((x) => x.data!)),
  })

type ProjectApi = {
  readonly list: () => Promise<unknown>
  readonly current: (input?: ProjectCurrentInput) => Promise<ProjectCurrentOutput>
}
export type CurrentProjectApi = {
  readonly list: () => Promise<unknown>
  readonly current?: OpencodeClient["project"]["current"]
}

type McpApi = ServerApi["mcp"]
type PermissionApi = ServerApi["permission"]
type QuestionApi = ServerApi["question"]
type VcsApi = ServerApi["vcs"]

export const loadProjectsQuery = (
  scope: ServerScope,
  api: ProjectApi,
  current?: CurrentProjectApi,
  protocol?: Promise<ServerProtocol>,
) =>
  queryOptions({
    queryKey: [scope, "project"],
    queryFn: () =>
      retry(async () => {
        const protocolKind = await protocol
        let projects: Project[]
        if (current) {
          try {
            // The current SDK is the canonical project endpoint. Some older
            // servers report the legacy protocol but still expose this route;
            // only fall back after a detected v1 endpoint rejects it.
            projects = normalizeProjectListResponse(await current.list())
          } catch (error) {
            if (protocolKind !== "v1") throw error
            projects = normalizeProjectListResponse(await api.list())
          }
        } else {
          projects = normalizeProjectListResponse(await api.list())
        }
        return projects
          .filter((p) => !!p?.id)
          .filter((p) => !!p.worktree && !p.worktree.includes("opencode-test"))
          .map(normalizeProjectInfo)
          .slice()
          .sort((a, b) => cmp(a.id, b.id))
      }),
  })

export async function bootstrapGlobal(input: {
  serverSDK: OpencodeClient
  serverAPI: CatalogApi & { readonly project: ProjectApi }
  protocol?: Promise<ServerProtocol>
  scope: ServerScope
  requestFailedTitle: string
  translate: (key: string, vars?: Record<string, string | number>) => string
  formatMoreCount: (count: number) => string
  setGlobalStore: SetStoreFunction<GlobalStore>
  queryClient: QueryClient
}) {
  if (input.protocol) {
    try {
      await input.protocol
    } catch (error) {
      showErrors({
        errors: [error],
        title: input.requestFailedTitle,
        translate: input.translate,
        formatMoreCount: input.formatMoreCount,
      })
      throw error
    }
  }

  const slow = [
    () => input.queryClient.fetchQuery(loadGlobalConfigQuery(input.scope, input.serverSDK, input.protocol)),
    () =>
      input.queryClient.fetchQuery(
        loadProvidersQuery(input.scope, null, input.serverAPI, input.serverSDK, input.protocol),
      ),
    () => input.queryClient.fetchQuery(loadPathQuery(input.scope, null, input.serverSDK, input.protocol)),
    () =>
      input.queryClient
        .fetchQuery(
          loadProjectsQuery(
            input.scope,
            input.serverAPI.project,
            { list: () => input.serverSDK.project.list() } as unknown as CurrentProjectApi,
            input.protocol,
          ),
        )
        .then((data) => input.setGlobalStore("project", data)),
  ]
  const results = await runAll(slow)
  const failures = errors(results)
  if (failures.length > 0) {
    showErrors({
      errors: failures,
      title: input.requestFailedTitle,
      translate: input.translate,
      formatMoreCount: input.formatMoreCount,
    })
    throw failures[0]
  }
  input.setGlobalStore("ready", true)
}

function groupBySession<T extends { id: string; sessionID: string }>(input: T[]) {
  return input.reduce<Record<string, T[]>>((acc, item) => {
    if (!item?.id || !item.sessionID) return acc
    const list = acc[item.sessionID]
    if (list) list.push(item)
    if (!list) acc[item.sessionID] = [item]
    return acc
  }, {})
}

function normalizePermissionList(value: unknown) {
  return normalizeArrayResponse(value, "permission.list").map((item) =>
    normalizePermissionRequest(item as Parameters<typeof normalizePermissionRequest>[0]),
  )
}

function projectID(directory: string, projects: Project[]) {
  return projects.find((project) => project.worktree === directory || project.sandboxes?.includes(directory))?.id
}

function mergeSession(setStore: SetStoreFunction<State>, session: Session) {
  setStore("session", (list) => {
    const next = list.slice()
    const idx = next.findIndex((item) => item.id >= session.id)
    if (idx === -1) return [...next, session]
    if (next[idx]?.id === session.id) {
      next[idx] = session
      return next
    }
    next.splice(idx, 0, session)
    return next
  })
}

function warmSessions(input: {
  ids: string[]
  store: Store<State>
  setStore: SetStoreFunction<State>
  api: SessionApi
}) {
  const known = new Set(input.store.session.map((item) => item.id))
  const ids = [...new Set(input.ids)].filter((id) => !!id && !known.has(id))
  if (ids.length === 0) return Promise.resolve()
  return Promise.all(
    ids.map((sessionID) =>
      retry(() => input.api.get({ sessionID })).then((session) =>
        mergeSession(input.setStore, normalizeSessionInfo(session)),
      ),
    ),
  ).then(() => undefined)
}

export const loadProvidersQuery = (
  scope: ServerScope,
  directory: string | null,
  sdk: CatalogApi,
  legacy?: OpencodeClient,
  protocol?: Promise<ServerProtocol>,
) =>
  queryOptions({
    queryKey: [scope, directory, "providers"],
    queryFn: () =>
      retry(async () => {
        if ((await protocol) === "v1" && legacy) {
          const result = await legacy.provider.list()
          return normalizeProviderList(result.data!)
        }
        const location = directory ? { location: { directory } } : undefined
        const [providers, models, integrations] = await Promise.all([
          sdk.provider.list(location),
          sdk.model.list(location),
          // Provider credentials live on the selected OpenCode server. Fetch
          // the server's auth catalogue through the same authenticated client
          // so the web UI never falls back to asking for a local API key.
          Promise.resolve(
            (sdk as CatalogApi & { integration?: { list?: (input?: unknown) => Promise<{ data?: unknown }> } })
              .integration?.list?.(location),
          ).catch(() => undefined),
        ])
        let defaultModel: ModelDefaultOutput["data"] = null
        try {
          defaultModel = (await sdk.model.default(location)).data
        } catch (error) {
          // Older/current OpenCode servers can expose provider and model data
          // without the optional default-model endpoint. The catalogue remains
          // usable; resolve a default from the first connected model instead.
          if (!(error instanceof ClientError) || error.reason !== "UnsupportedContentType") throw error
        }
        const normalized = normalizeProviderList(providers.data, models.data, defaultModel)
        const connectedRemoteProviders = new Set(
          ((integrations?.data ?? []) as Array<{ id?: unknown; connections?: unknown }>).flatMap((integration) =>
            typeof integration.id === "string" && Array.isArray(integration.connections) && integration.connections.length > 0
              ? [integration.id]
              : [],
          ),
        )
        if (connectedRemoteProviders.size === 0) return normalized
        return {
          ...normalized,
          connected: Array.from(new Set([...normalized.connected, ...connectedRemoteProviders])).filter((id) => normalized.all.has(id)),
        }
      }),
  })

type AgentListApi = {
  readonly list: (input?: AgentListInput) => Promise<AgentListOutput>
}

type CommandListApi = {
  readonly list: (input?: CommandListInput) => Promise<CommandListOutput>
}

type ReferenceListApi = {
  readonly list: (input?: ReferenceListInput) => Promise<ReferenceListOutput>
}

export const loadAgentsQuery = (
  scope: ServerScope,
  directory: string,
  sdk: AgentListApi,
  legacy?: OpencodeClient,
  protocol?: Promise<ServerProtocol>,
) =>
  queryOptions({
    queryKey: [scope, directory, "agents"],
    queryFn: () =>
      retry(async () => {
        if ((await protocol) === "v1" && legacy) {
          return normalizeAgentList(normalizeArrayResponse(await legacy.app.agents(), "agent.list") as AgentListOutput["data"])
        }
        return sdk.list({ location: { directory } }).then((result) =>
          normalizeAgentList(normalizeArrayResponse(result, "agent.list") as AgentListOutput["data"]),
        )
      }),
  })

export const loadCommands = (
  directory: string,
  api: CommandListApi,
  legacy?: OpencodeClient,
  protocol?: Promise<ServerProtocol>,
): Promise<CommandInfo[]> =>
  retry(async () => {
    if ((await protocol) === "v1" && legacy) {
      return normalizeArrayResponse<CommandListOutput["data"][number]>(await legacy.command.list(), "command.list").map(
        (command) => {
          const model = command.model as unknown
          const [providerID, id] =
            typeof model === "string"
              ? model.split("/")
              : model && typeof model === "object"
                ? [
                    typeof (model as { providerID?: unknown }).providerID === "string"
                      ? (model as { providerID: string }).providerID
                      : undefined,
                    typeof (model as { id?: unknown }).id === "string" ? (model as { id: string }).id : undefined,
                  ]
                : []
          return {
            name: command.name,
            template: command.template,
            description: command.description,
            agent: command.agent,
            model: providerID && id ? { providerID, id } : undefined,
            subtask: command.subtask,
            // source: command.source === "skill" ? undefined : command.source,
          }
        },
      )
    }
    return api
      .list({ location: { directory } })
      .then((result) => normalizeArrayResponse<CommandInfo>(result, "command.list"))
  })

export const loadPathQuery = (
  scope: ServerScope,
  directory: string | null,
  sdk: OpencodeClient,
  protocol?: Promise<ServerProtocol>,
) =>
  queryOptions<Path>({
    queryKey: [scope, directory, "path"],
    queryFn: async () => {
      if ((await protocol) !== "v1")
        return { state: "", config: "", worktree: "", directory: directory ?? "", home: "" }
      return retry(() => sdk.path.get({ directory: directory ?? undefined }).then((result) => result.data!))
    },
  })

export const loadReferencesQuery = (
  scope: ServerScope,
  directory: string,
  api: ReferenceListApi,
  legacy?: OpencodeClient,
  protocol?: Promise<ServerProtocol>,
) =>
  queryOptions<ReferenceInfo[]>({
    queryKey: [scope, directory, "references"] as const,
    queryFn: () =>
      retry(async () => {
        if ((await protocol) === "v1" && legacy) {
          const result = await legacy.v2.reference.list()
          return normalizeArrayResponse<ReferenceInfo>(result.data, "reference.list")
        }
        return api
          .list({ location: { directory } })
          .then((result) => normalizeArrayResponse<ReferenceInfo>(result, "reference.list"))
      }),
  })

export async function bootstrapDirectory(input: {
  directory: string
  scope: ServerScope
  mcp: boolean
  sdk: OpencodeClient
  api: CatalogApi & {
    readonly agent: AgentListApi
    readonly command: CommandListApi
    readonly mcp: McpApi
    readonly permission: PermissionApi
    readonly project: ProjectApi
    readonly question: QuestionApi
    readonly reference: ReferenceListApi
    readonly session: SessionApi
    readonly vcs: VcsApi
  }
  store: Store<State>
  setStore: SetStoreFunction<State>
  vcsCache: VcsCache
  loadSessions: (directory: string) => Promise<unknown> | void
  translate: (key: string, vars?: Record<string, string | number>) => string
  global: {
    config: Config
    path: Path
    project: Project[]
    provider: NormalizedProviderListResponse
  }
  queryClient: QueryClient
  session?: ServerSession
  protocol?: Promise<ServerProtocol>
}) {
  const loading = input.store.status !== "complete"
  const seededProject = projectID(input.directory, input.global.project)
  const seededPath = input.global.path.directory === input.directory ? input.global.path : undefined
  if (seededProject) input.setStore("project", seededProject)
  if (seededPath) input.setStore("path", seededPath)
  if (Object.keys(input.store.config).length === 0 && Object.keys(input.global.config).length > 0) {
    input.setStore("config", reconcile(input.global.config, { merge: false }))
  }
  if (loading) input.setStore("status", "partial")

  const revKey = ScopedKey.from(input.scope, input.directory)
  const rev = (providerRev.get(revKey) ?? 0) + 1
  providerRev.set(revKey, rev)
  ;(async () => {
    const slow = [
      () => Promise.resolve(input.loadSessions(input.directory)),
      () =>
        input.queryClient
          .ensureQueryData(loadAgentsQuery(input.scope, input.directory, input.api.agent, input.sdk, input.protocol))
          .then((data) => input.setStore("agent", data)),
      () =>
        retry(async () => {
          if ((await input.protocol) !== "v1") return
          return input.sdk.config.get().then((x) => input.setStore("config", reconcile(x.data!, { merge: false })))
        }),
      () =>
        retry(() =>
          (async () => {
            if ((await input.protocol) !== "v1") return
            const x = await input.sdk.session.status()
            if (!input.session) {
              input.setStore("session_status", x.data!)
              return
            }
            const statuses = x.data ?? {}
            input.session.set(
              "session_status",
              produce((draft) => {
                for (const sessionID of Object.keys(draft)) {
                  if (statuses[sessionID]) continue
                  if (input.session?.get(sessionID)?.directory === input.directory) delete draft[sessionID]
                }
              }),
            )
            for (const [sessionID, status] of Object.entries(statuses)) {
              input.session.set("session_status", sessionID, reconcile(status))
            }
            await Promise.all(
              Object.keys(statuses).map((sessionID) => input.session!.resolve(sessionID).catch(() => undefined)),
            )
          })(),
        ),
      !seededProject &&
        (() =>
          retry(() => input.api.project.current({ location: { directory: input.directory } })).then((project) =>
            input.setStore("project", project.id),
          )),
      !seededPath &&
        (() =>
          input.queryClient
            .ensureQueryData(loadPathQuery(input.scope, input.directory, input.sdk, input.protocol))
            .then((data) => {
              const next = projectID(data.directory ?? input.directory, input.global.project)
              if (next) input.setStore("project", next)
            })),
      () =>
        retry(async () => {
          if ((await input.protocol) !== "v1") return
          return input.sdk.vcs.get().then((result) => {
            const next = { branch: result.data?.branch, default_branch: result.data?.default_branch }
            input.setStore("vcs", next)
            if (next) input.vcsCache.setStore("value", next)
          })
        }),
      input.mcp &&
        (() =>
          loadCommands(input.directory, input.api.command, input.sdk, input.protocol).then((commands) =>
            input.setStore("command", commands),
          )),
      () =>
        input.queryClient.fetchQuery(
          loadReferencesQuery(input.scope, input.directory, input.api.reference, input.sdk, input.protocol),
        ),
      () =>
        retry(() =>
          (async () => {
            if ((await input.protocol) === "v1") {
              return normalizePermissionList(await input.sdk.permission.list())
            }
            return input.api.permission.request
              .list({ location: { directory: input.directory } })
              .then((result) => normalizePermissionList(result))
          })().then((permissions) => {
            const ids = permissions.map((permission) => permission.sessionID)
            const grouped = groupBySession(
              permissions.filter((permission) => !!permission.id && !!permission.sessionID),
            )
            const warm = input.session
              ? Promise.all(ids.map((sessionID) => input.session!.resolve(sessionID))).then(() => undefined)
              : warmSessions({ ids, store: input.store, setStore: input.setStore, api: input.api.session })
            return warm.then(() =>
              batch(() => {
                const current = input.session?.data.permission ?? input.store.permission
                for (const sessionID of Object.keys(current)) {
                  if (grouped[sessionID]) continue
                  if (input.session?.get(sessionID)?.directory !== input.directory) continue
                  if (input.session) input.session.set("permission", sessionID, [])
                  if (!input.session) input.setStore("permission", sessionID, [])
                }
                for (const [sessionID, permissions] of Object.entries(grouped)) {
                  const value = reconcile(
                    permissions.filter((p) => !!p?.id).sort((a, b) => cmp(a.id, b.id)),
                    { key: "id" },
                  )
                  if (input.session) input.session.set("permission", sessionID, value)
                  if (!input.session) input.setStore("permission", sessionID, value)
                }
              }),
            )
          }),
        ),
      () =>
        retry(() =>
          (async () => {
            if ((await input.protocol) === "v1") {
              return normalizeArrayResponse<QuestionRequest>(await input.sdk.question.list(), "question.list")
            }
            return input.api.question.request
              .list({ location: { directory: input.directory } })
              .then((result) => normalizeArrayResponse<QuestionRequest>(result, "question.list"))
          })().then((questions) => {
            const ids = questions.map((question) => question.sessionID)
            const grouped = groupBySession(
              questions.filter((question) => !!question.id && !!question.sessionID) as QuestionRequest[],
            )
            const warm = input.session
              ? Promise.all(ids.map((sessionID) => input.session!.resolve(sessionID))).then(() => undefined)
              : warmSessions({ ids, store: input.store, setStore: input.setStore, api: input.api.session })
            return warm.then(() =>
              batch(() => {
                const current = input.session?.data.question ?? input.store.question
                for (const sessionID of Object.keys(current)) {
                  if (grouped[sessionID]) continue
                  if (input.session?.get(sessionID)?.directory !== input.directory) continue
                  if (input.session) input.session.set("question", sessionID, [])
                  if (!input.session) input.setStore("question", sessionID, [])
                }
                for (const [sessionID, questions] of Object.entries(grouped)) {
                  const value = reconcile(
                    questions.filter((q) => !!q?.id).sort((a, b) => cmp(a.id, b.id)),
                    { key: "id" },
                  )
                  if (input.session) input.session.set("question", sessionID, value)
                  if (!input.session) input.setStore("question", sessionID, value)
                }
              }),
            )
          }),
        ),
      () => Promise.resolve(input.loadSessions(input.directory)),
      input.mcp &&
        (() =>
          input.queryClient.fetchQuery(
            loadMcpQuery(input.scope, input.directory, input.api.mcp, input.sdk, input.protocol),
          )),
      input.mcp &&
        (() =>
          input.queryClient.fetchQuery(
            loadMcpResourcesQuery(input.scope, input.directory, input.api.mcp, input.sdk, input.protocol),
          )),
      () =>
        input.queryClient.fetchQuery(loadProvidersQuery(input.scope, input.directory, input.api, input.sdk, input.protocol)),
    ].filter(Boolean) as (() => Promise<any>)[]

    await waitForPaint()
    const slowErrs = errors(await runAll(slow))
    if (slowErrs.length > 0) {
      console.error("Failed to finish bootstrap instance", slowErrs[0])
      void clientDiagnostics.report("bootstrap.error", {
        operation: "slow_resources",
        errorCode: slowErrs[0] instanceof Error ? slowErrs[0].name : "BOOTSTRAP_RESOURCE_FAILED",
      })
      const project = getFilename(input.directory)
      showToast({
        variant: "error",
        title: input.translate("toast.project.reloadFailed.title", { project }),
        description: formatServerError(slowErrs[0], input.translate),
      })
    }

    if (loading && slowErrs.length === 0) input.setStore("status", "complete")
  })()
}
