import { describe, expect, test } from "bun:test"
import { createStore } from "solid-js/store"
import { QueryClient } from "@tanstack/solid-query"
import type { Config, OpencodeClient, Project } from "@opencode-ai/sdk/v2/client"
import type { AgentApi, CatalogApi, CommandApi, ReferenceApi } from "@opencode-ai/client/promise"
import type { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
import { ClientError } from "@opencode-ai/client"
import {
  bootstrapDirectory,
  type CurrentProjectApi,
  loadAgentsQuery,
  loadCommands,
  loadGlobalConfigQuery,
  loadPathQuery,
  loadProjectsQuery,
  loadProvidersQuery,
  loadReferencesQuery,
} from "./bootstrap"
import type { State, VcsCache } from "./types"
import { ServerScope } from "@/utils/server-scope"
import type { ServerApi } from "@/utils/server"

type ProjectApi = ServerApi["project"]

const provider = { all: new Map(), connected: [], default: {} } satisfies NormalizedProviderListResponse
const api = {
  agent: { list: async () => ({ location: {}, data: [] }) },
  provider: { list: async () => ({ location: {}, data: [] }) },
  model: {
    list: async () => ({ location: {}, data: [] }),
    default: async () => ({ location: {}, data: null }),
  },
  permission: { request: { list: async () => ({ location: {}, data: [] }) } },
  project: {
    list: async () => [],
    current: async () => ({ id: "project", directory: "/project" }),
  },
  question: { request: { list: async () => ({ location: {}, data: [] }) } },
  reference: { list: async () => ({ location: {}, data: [] }) },
  vcs: { get: async () => ({ location: {}, data: {} }) },
} as unknown as ServerApi

function directoryState() {
  return createStore<State>({
    status: "loading",
    agent: [],
    command: [],
    reference: [],
    project: "",
    projectMeta: undefined,
    icon: undefined,
    provider_ready: true,
    provider,
    config: {},
    path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_working(id: string) {
      return this.session_status[id]?.type !== "idle"
    },
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp_ready: true,
    mcp: {},
    mcp_resource: {},
    lsp_ready: true,
    lsp: [],
    vcs: undefined,
    limit: 5,
    message: {},
    session_message: {},
    part: {},
    part_text_accum_delta: {},
  })
}

describe("bootstrapDirectory", () => {
  test("uses legacy MCP endpoints while refreshing a v1 directory", async () => {
    const legacyConfigReads: string[] = []
    const mcpReads: string[] = []
    const [store, setStore] = directoryState()

    await bootstrapDirectory({
      directory: "/project",
      scope: ServerScope.local,
      mcp: true,
      global: {
        config: {} satisfies Config,
        path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
        project: [{ id: "project", worktree: "/project" } as Project],
        provider,
      },
      sdk: {
        app: { agents: async () => ({ data: [{ name: "build", mode: "primary" }] }) },
        config: {
          get: async () => {
            legacyConfigReads.push("directory")
            return { data: {} }
          },
        },
        session: { status: async () => ({ data: {} }) },
        vcs: { get: async () => ({ data: undefined }) },
        command: {
          list: async () => {
            mcpReads.push("command")
            return { data: [] }
          },
        },
        permission: { list: async () => ({ data: [] }) },
        question: { list: async () => ({ data: [] }) },
        v2: { reference: { list: async () => ({ data: { data: [] } }) } },
        mcp: {
          status: async () => {
            mcpReads.push("status")
            return { data: {} }
          },
        },
        experimental: {
          resource: {
            list: async () => {
              mcpReads.push("resource")
              return { data: {} }
            },
          },
        },
        provider: { list: async () => ({ data: { all: [], connected: [], default: {} } }) },
      } as unknown as OpencodeClient,
      api,
      store,
      setStore,
      vcsCache: { setStore() {} } as unknown as VcsCache,
      loadSessions() {},
      translate: (key) => key,
      queryClient: new QueryClient(),
      protocol: Promise.resolve("v1"),
    })

    expect(store.status).toBe("partial")

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(store.status).toBe("complete")
    expect(legacyConfigReads).toEqual(["directory"])
    expect(mcpReads.sort()).toEqual(["command", "resource", "status"])
  })

  test("skips legacy config while refreshing a v2 directory", async () => {
    const [store, setStore] = directoryState()

    await bootstrapDirectory({
      directory: "/project",
      scope: ServerScope.local,
      mcp: false,
      global: {
        config: {} satisfies Config,
        path: { state: "", config: "", worktree: "/project", directory: "/project", home: "/home" },
        project: [{ id: "project", worktree: "/project" } as Project],
        provider,
      },
      sdk: {
        config: {
          get: async () => {
            throw new Error("legacy directory config should not be called")
          },
        },
      } as unknown as OpencodeClient,
      api,
      store,
      setStore,
      vcsCache: { setStore() {} } as unknown as VcsCache,
      loadSessions() {},
      translate: (key) => key,
      queryClient: new QueryClient(),
      protocol: Promise.resolve("v2"),
    })

    expect(store.status).toBe("partial")

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(store.status).toBe("complete")
  })
})

describe("config queries", () => {
  test("loads global config for v2 servers gracefully", async () => {
    const config = { default_agent: "heidi" } satisfies Config
    const sdk = {
      global: {
        config: {
          get: async () => {
            return { data: config }
          },
        },
      },
    } as unknown as OpencodeClient

    const result = await new QueryClient().fetchQuery(
      loadGlobalConfigQuery(ServerScope.local, sdk, Promise.resolve("v2")),
    )

    expect(result).toEqual(config)
  })

  test("loads legacy global config for v1 servers", async () => {
    const calls: string[] = []
    const config = { shell: "zsh" } satisfies Config
    const sdk = {
      global: {
        config: {
          get: async () => {
            calls.push("global")
            return { data: config }
          },
        },
      },
    } as unknown as OpencodeClient

    const result = await new QueryClient().fetchQuery(
      loadGlobalConfigQuery(ServerScope.local, sdk, Promise.resolve("v1")),
    )

    expect(result).toEqual(config)
    expect(calls).toEqual(["global"])
  })
})

describe("query keys", () => {
  test("partitions identical directories by server scope", () => {
    const client = {} as Parameters<typeof loadPathQuery>[2]
    const api = {} as CatalogApi
    const remote = "https://debian.example" as typeof ServerScope.local

    expect([...loadPathQuery(ServerScope.local, "/repo", client).queryKey]).toEqual(["local", "/repo", "path"])
    expect([...loadPathQuery(remote, "/repo", client).queryKey]).toEqual(["https://debian.example", "/repo", "path"])
    expect([...loadProvidersQuery(remote, null, api).queryKey]).toEqual(["https://debian.example", null, "providers"])
  })

  test("loads the current provider and model catalog", async () => {
    const calls: unknown[] = []
    const api = {
      provider: {
        list: async (input: unknown) => {
          calls.push(["provider", input])
          return { location: {}, data: [{ id: "openai", name: "OpenAI", package: "@ai-sdk/openai" }] }
        },
      },
      model: {
        list: async (input: unknown) => {
          calls.push(["model", input])
          return { location: {}, data: [] }
        },
        default: async (input: unknown) => {
          calls.push(["default", input])
          return { location: {}, data: null }
        },
      },
    } as unknown as CatalogApi

    const result = await new QueryClient().fetchQuery(loadProvidersQuery(ServerScope.local, "/repo", api))

    expect(calls).toEqual([
      ["provider", { location: { directory: "/repo" } }],
      ["model", { location: { directory: "/repo" } }],
      ["default", { location: { directory: "/repo" } }],
    ])
    expect(result.connected).toEqual(["openai"])
  })

  test("V2 providers returned by provider.list remain connected when integration.list is unavailable", async () => {
    const result = await new QueryClient().fetchQuery(
      loadProvidersQuery(ServerScope.local, "/repo", {
        provider: {
          list: async () => ({
            location: {},
            data: [
              { id: "anthropic", name: "Anthropic", package: "@ai-sdk/anthropic" },
              { id: "custom-router", name: "Custom Router", package: "@ai-sdk/openai-compatible", integrationID: "9router" },
            ],
          }),
        },
        model: {
          list: async () => ({
            location: {},
            data: [
              {
                id: "claude",
                modelID: "claude",
                providerID: "anthropic",
                name: "Claude",
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                variants: [],
                time: { released: Date.now() },
                cost: [],
                status: "active",
                enabled: true,
                limit: { context: 100, output: 100 },
              },
              {
                id: "beam",
                modelID: "beam",
                providerID: "custom-router",
                name: "Beam",
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                variants: [],
                time: { released: Date.now() },
                cost: [],
                status: "active",
                enabled: true,
                limit: { context: 100, output: 100 },
              },
            ],
          }),
          default: async () => ({ location: {}, data: null }),
        },
        integration: {
          list: async () => {
            throw new Error("integration catalogue unavailable")
          },
        },
      } as unknown as CatalogApi),
    )

    expect(result.connected).toEqual(["anthropic", "custom-router"])
    expect((result.all.get("custom-router") as { integrationID?: string } | undefined)?.integrationID).toBe("9router")
    expect(result.all.get("anthropic")?.models["claude"]).toBeDefined()
    expect(result.all.get("custom-router")?.models["beam"]).toBeDefined()
  })

  test("V2 providers returned by provider.list remain connected when integration.list is empty", async () => {
    const result = await new QueryClient().fetchQuery(
      loadProvidersQuery(ServerScope.local, "/repo", {
        provider: { list: async () => ({ location: {}, data: [{ id: "openai", name: "OpenAI" }] }) },
        model: { list: async () => ({ location: {}, data: [] }), default: async () => ({ location: {}, data: null }) },
      } as unknown as CatalogApi),
    )

    expect(result.connected).toEqual(["openai"])
  })

  test("uses remote integration connections as provider auth state and maps integrationID correctly", async () => {
    const result = await new QueryClient().fetchQuery(
      loadProvidersQuery(ServerScope.local, "/repo", {
        provider: {
          list: async () => ({
            location: {},
            data: [
              { id: "anthropic", name: "Anthropic" },
              { id: "deepseek-9router", name: "DeepSeek", integrationID: "9router" },
              { id: "unconfigured-provider", name: "Unconfigured" },
            ],
          }),
        },
        model: { list: async () => ({ location: {}, data: [] }), default: async () => ({ location: {}, data: null }) },
        integration: {
          list: async () => ({
            location: {},
            data: [
              { id: "anthropic", connections: [{ type: "credential", id: "anthropic" }] },
              { id: "9router", connections: [{ type: "credential", id: "9router" }] },
              { id: "unconfigured-provider", connections: [] },
            ],
          }),
        },
      } as unknown as CatalogApi),
    )

    // provider.list is authoritative for availability; integration.list is
    // connection metadata and may not remove a returned provider.
    expect(result.connected).toEqual(["anthropic", "deepseek-9router", "unconfigured-provider"])
    expect((result.all.get("deepseek-9router") as { integrationID?: string } | undefined)?.integrationID).toBe("9router")
  })

  test("keeps providers and models when the optional default endpoint is unsupported", async () => {
    const result = await new QueryClient().fetchQuery(
      loadProvidersQuery(ServerScope.local, "/repo", {
        provider: {
          list: async () => ({ location: {}, data: [{ id: "openai", name: "OpenAI" }] }),
        },
        model: {
          list: async () => ({ location: {}, data: [] }),
          default: async () => {
            throw new ClientError("UnsupportedContentType")
          },
        },
      } as unknown as CatalogApi),
    )

    expect(result.connected).toEqual(["openai"])
    expect(result.all.size).toBe(1)
  })

  test("loads agents from the current location-scoped endpoint", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return { location: {}, data: [] }
      },
    } as unknown as AgentApi

    const result = await new QueryClient().fetchQuery(loadAgentsQuery(ServerScope.local, "/repo", api))

    expect(calls).toEqual([{ location: { directory: "/repo" } }])
    expect(result).toEqual([])
  })

  test("loads commands from the current location-scoped endpoint", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return {
          location: {},
          data: [{ name: "review", template: "Review files" /* source: "command" as const */ }],
        }
      },
    } as unknown as CommandApi

    const result = await loadCommands("/repo", api)

    expect(calls).toEqual([{ location: { directory: "/repo" } }])
    expect(result).toEqual([{ name: "review", template: "Review files" /* source: "command" */ }])
  })

  test("loads projects from the current endpoint", async () => {
    const api = {
      list: async () => [
        { id: "b", worktree: "/b", time: { created: 1, updated: 1 }, sandboxes: [] },
        { id: "a", worktree: "/a", time: { created: 1, updated: 1 }, sandboxes: [] },
      ],
    } as unknown as ProjectApi

    const result = await new QueryClient().fetchQuery(loadProjectsQuery(ServerScope.local, api))

    expect(result.map((project) => project.id)).toEqual(["a", "b"])
  })

  test("uses the v2 project endpoint when the detected protocol is v2", async () => {
    const result = await new QueryClient().fetchQuery(
      loadProjectsQuery(
        ServerScope.local,
        {
          list: async () => {
            throw new Error("legacy project endpoint should not be called")
          },
        } as unknown as ProjectApi,
        {
          list: async () => ({
            data: [{ id: "v2", worktree: "/v2", time: { created: 1, updated: 1 }, sandboxes: [] }],
            request: {},
            response: {},
          }),
        } as unknown as CurrentProjectApi,
        Promise.resolve("v2"),
      ),
    )

    expect(result.map((project) => project.id)).toEqual(["v2"])
  })

  test("loads references from the current location-scoped endpoint", async () => {
    const calls: unknown[] = []
    const api = {
      list: async (input: unknown) => {
        calls.push(input)
        return { location: {}, data: [{ name: "AGENTS.md", path: "/repo/AGENTS.md", source: "instructions" }] }
      },
    } as unknown as ReferenceApi

    const result = await new QueryClient().fetchQuery(loadReferencesQuery(ServerScope.local, "/repo", api))

    expect(calls).toEqual([{ location: { directory: "/repo" } }])
    expect(result).toHaveLength(1)
  })
})
