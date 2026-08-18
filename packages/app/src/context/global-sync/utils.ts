import type {
  AgentListOutput,
  ModelDefaultOutput,
  ModelListOutput,
  PermissionV2Request,
  ProviderListOutput,
} from "@opencode-ai/client/promise"
import type { Agent, PermissionRequest, Project, Provider, ProviderListResponse } from "@opencode-ai/sdk/v2/client"
import type { Project as CurrentProject } from "@opencode-ai/client/promise"
import { NormalizedProviderListResponse } from "@opencode-ai/session-ui/context"
export { pathKey as directoryKey, type PathKey as DirectoryKey } from "@/utils/path-key"

export class ProviderResponseError extends Error {
  readonly code = "PROVIDER_RESPONSE_INVALID"

  constructor(detail: string) {
    super(`PROVIDER_RESPONSE_INVALID: ${detail}`)
    this.name = "ProviderResponseError"
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function normalizeAgentList(input: AgentListOutput["data"] | Agent[]): Agent[] {
  if (input.every((agent) => !("request" in agent))) return input as Agent[]
  return (input as AgentListOutput["data"]).map((agent) => ({
    name: agent.id,
    description: agent.description,
    mode: agent.mode,
    hidden: agent.hidden,
    temperature:
      typeof agent.request?.settings?.temperature === "number" ? agent.request.settings.temperature : undefined,
    topP: typeof agent.request?.settings?.topP === "number" ? agent.request.settings.topP : undefined,
    color: agent.color,
    permission: agent.permissions.map((rule) => ({
      permission: rule.action,
      pattern: rule.resource,
      action: rule.effect,
    })),
    model: agent.model && { providerID: agent.model.providerID, modelID: agent.model.id },
    variant: agent.model?.variant,
    prompt: agent.system,
    options: agent.request.settings,
    steps: agent.steps,
  }))
}

export function normalizePermissionRequest(input: PermissionV2Request | PermissionRequest): PermissionRequest {
  if ("permission" in input) return input
  return {
    id: input.id,
    sessionID: input.sessionID,
    permission: input.action,
    patterns: input.resources,
    always: input.save ?? [],
    metadata: input.metadata ?? {},
    tool:
      input.source?.type === "tool" ? { messageID: input.source.messageID, callID: input.source.callID } : undefined,
  }
}

export function normalizeProviderList(
  providers: ProviderListOutput["data"] | ProviderListResponse,
  models?: ModelListOutput["data"],
  defaultModel?: ModelDefaultOutput["data"],
): NormalizedProviderListResponse {
  if (!Array.isArray(providers)) {
    if (
      !record(providers) ||
      !Array.isArray(providers.all) ||
      !Array.isArray(providers.connected) ||
      !record(providers.default)
    ) {
      throw new ProviderResponseError("expected a normalized provider envelope")
    }
    return {
      ...providers,
      all: new Map(
        providers.all.map((provider) => [
          provider.id,
          {
            ...provider,
            models: Object.fromEntries(
              Object.entries(provider.models).filter(([, model]) => model.status !== "deprecated"),
            ),
          },
        ]),
      ),
    }
  }
  if (models !== undefined && !Array.isArray(models)) throw new ProviderResponseError("expected model data to be an array")
  if (
    defaultModel !== undefined &&
    defaultModel !== null &&
    (!record(defaultModel) || typeof defaultModel.id !== "string" || typeof defaultModel.providerID !== "string")
  ) {
    throw new ProviderResponseError("expected a valid default model")
  }
  if (
    providers.some(
      (provider) => !record(provider) || typeof provider.id !== "string" || typeof provider.name !== "string",
    )
  ) {
    throw new ProviderResponseError("expected provider entries with id and name")
  }
  if (
    (models ?? []).some(
      (model) =>
        !record(model) ||
        typeof model.id !== "string" ||
        typeof model.providerID !== "string" ||
        typeof model.name !== "string" ||
        !record(model.capabilities) ||
        !Array.isArray(model.capabilities.input) ||
        !Array.isArray(model.capabilities.output) ||
        !Array.isArray(model.cost) ||
        !Array.isArray(model.variants) ||
        !record(model.time) ||
        typeof model.time.released !== "number" ||
        !record(model.limit),
    )
  ) {
    throw new ProviderResponseError("expected valid model entries")
  }
  const all = new Map<string, Provider>()

  for (const provider of providers) {
    all.set(provider.id, {
      id: provider.id,
      name: provider.name,
      source: "custom",
      env: [],
      options: provider.settings ?? {},
      models: {},
    })
  }

  for (const model of models ?? []) {
    const provider = all.get(model.providerID)
    if (!provider || model.status === "deprecated") continue
    const cost = model.cost.find((item) => item.tier === undefined) ?? model.cost[0]
    provider.models[model.id] = {
      id: model.id,
      providerID: model.providerID,
      api: {
        id: model.modelID,
        url: "",
        npm: model.package ?? provider.id,
      },
      name: model.name,
      family: model.family,
      capabilities: {
        temperature: false,
        reasoning: false,
        attachment: model.capabilities.input.some((item) => item !== "text"),
        toolcall: model.capabilities.tools,
        input: {
          text: model.capabilities.input.includes("text"),
          audio: model.capabilities.input.includes("audio"),
          image: model.capabilities.input.includes("image"),
          video: model.capabilities.input.includes("video"),
          pdf: model.capabilities.input.includes("pdf"),
        },
        output: {
          text: model.capabilities.output.includes("text"),
          audio: model.capabilities.output.includes("audio"),
          image: model.capabilities.output.includes("image"),
          video: model.capabilities.output.includes("video"),
          pdf: model.capabilities.output.includes("pdf"),
        },
        interleaved: false,
      },
      cost: {
        input: cost?.input ?? 0,
        output: cost?.output ?? 0,
        cache: {
          read: cost?.cache.read ?? 0,
          write: cost?.cache.write ?? 0,
        },
      },
      limit: model.limit,
      status: model.status,
      options: model.settings ?? {},
      headers: model.headers ?? {},
      release_date: new Date(model.time.released).toISOString().slice(0, 10),
      variants: Object.fromEntries(model.variants.map((variant) => [variant.id, variant.settings ?? {}])),
    }
  }

  return {
    all,
    connected: providers.map((provider) => provider.id),
    defaultModel: defaultModel ? { providerID: defaultModel.providerID, modelID: defaultModel.id } : null,
    default: Object.fromEntries(
      providers.flatMap((provider) => {
        const model =
          defaultModel?.providerID === provider.id
            ? defaultModel
            : models?.find((item) => item.providerID === provider.id && item.status !== "deprecated")
        return model ? [[provider.id, model.id]] : []
      }),
    ),
  }
}

export function sanitizeProject(project: Project) {
  if (!project.icon?.url && !project.icon?.override) return project
  return {
    ...project,
    icon: {
      ...project.icon,
      url: undefined,
      override: undefined,
    },
  }
}

export function normalizeProjectInfo(project: Project | CurrentProject): Project {
  return {
    ...project,
    vcs: project.vcs === "git" ? "git" : undefined,
  }
}
