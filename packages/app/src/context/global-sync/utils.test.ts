import { describe, expect, test } from "bun:test"
import type {
  AgentListOutput,
  ModelDefaultOutput,
  ModelListOutput,
  ProviderListOutput,
} from "@opencode-ai/client/promise"
import {
  directoryKey,
  normalizeAgentList,
  normalizePermissionRequest,
  normalizeProviderList,
  ProviderResponseError,
} from "./utils"

describe("normalizeAgentList", () => {
  test("adapts current agents to the app agent shape", () => {
    const result = normalizeAgentList([
      {
        id: "build",
        name: "Build",
        mode: "primary",
        hidden: false,
        color: "primary",
        model: { id: "gpt-5", providerID: "openai", variant: "high" },
        request: { settings: { temperature: 0.2, topP: 0.9 }, headers: {}, body: {} },
        system: "Build software",
        permissions: [{ action: "read", resource: "*", effect: "allow" }],
      },
    ] as AgentListOutput["data"])

    expect(result).toEqual([
      {
        name: "build",
        description: undefined,
        mode: "primary",
        hidden: false,
        temperature: 0.2,
        topP: 0.9,
        color: "primary",
        permission: [{ permission: "read", pattern: "*", action: "allow" }],
        model: { providerID: "openai", modelID: "gpt-5" },
        variant: "high",
        prompt: "Build software",
        options: { temperature: 0.2, topP: 0.9 },
        steps: undefined,
      },
    ])
  })
})

describe("normalizePermissionRequest", () => {
  test("adapts the current permission request to app state", () => {
    expect(
      normalizePermissionRequest({
        id: "permission-1",
        sessionID: "session-1",
        action: "read",
        resources: ["README.md"],
        save: ["*.md"],
        metadata: { path: "README.md" },
        source: { type: "tool", messageID: "message-1", callID: "call-1" },
      }),
    ).toEqual({
      id: "permission-1",
      sessionID: "session-1",
      permission: "read",
      patterns: ["README.md"],
      always: ["*.md"],
      metadata: { path: "README.md" },
      tool: { messageID: "message-1", callID: "call-1" },
    })
  })
})

describe("normalizeProviderList", () => {
  test("rejects malformed provider envelopes with a structured error", () => {
    expect(() => normalizeProviderList({ data: [] } as never)).toThrow(ProviderResponseError)
    expect(() => normalizeProviderList({ data: [] } as never)).toThrow("PROVIDER_RESPONSE_INVALID")
  })

  test("groups current models into the app provider catalog", () => {
    const result = normalizeProviderList(
      [{ id: "openai", name: "OpenAI", package: "@ai-sdk/openai" }] as ProviderListOutput["data"],
      [
        {
          id: "gpt-5",
          modelID: "gpt-5",
          providerID: "openai",
          name: "GPT-5",
          capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
          variants: [{ id: "high" }],
          time: { released: 1 },
          cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }],
          status: "active",
          enabled: true,
          limit: { context: 128_000, output: 8_192 },
        },
        {
          id: "gpt-old",
          modelID: "gpt-old",
          providerID: "openai",
          name: "GPT Old",
          capabilities: { tools: false, input: ["text"], output: ["text"] },
          variants: [],
          time: { released: 0 },
          cost: [],
          status: "deprecated",
          enabled: true,
          limit: { context: 1, output: 1 },
        },
      ] as ModelListOutput["data"],
      { id: "gpt-5", providerID: "openai" } as ModelDefaultOutput["data"],
    )

    expect(result.connected).toEqual(["openai"])
    expect(result.defaultModel).toEqual({ providerID: "openai", modelID: "gpt-5" })
    expect(result.default).toEqual({ openai: "gpt-5" })
    expect(result.all.get("openai")?.models["gpt-old"]).toBeUndefined()
    expect(result.all.get("openai")?.models["gpt-5"]).toMatchObject({
      id: "gpt-5",
      providerID: "openai",
      capabilities: { toolcall: true, attachment: true },
      cost: { input: 1, output: 2 },
      variants: { high: {} },
    })
  })

  test("preserves an empty current default", () => {
    expect(normalizeProviderList([] as ProviderListOutput["data"], [], null).defaultModel).toBeNull()
  })

  test("does not turn an unknown release timestamp into an old release date", () => {
    const result = normalizeProviderList(
      [{ id: "9router", name: "9router", package: "@ai-sdk/openai-compatible" }] as ProviderListOutput["data"],
      [
        {
          id: "heidi-antigravity",
          modelID: "heidi-antigravity",
          providerID: "9router",
          name: "heidi-antigravity",
          capabilities: { tools: false, input: [], output: [] },
          variants: [],
          time: { released: 0 },
          cost: [],
          status: "active",
          enabled: true,
          limit: { context: 0, output: 0 },
        },
      ] as ModelListOutput["data"],
    )

    expect(result.all.get("9router")?.models["heidi-antigravity"]?.release_date).toBe("")
  })

  test("V2 provider.list ids remain connected and integrationID metadata is preserved", () => {
    const result = normalizeProviderList(
      [
        { id: "anthropic", name: "Anthropic", package: "@ai-sdk/anthropic" },
        { id: "custom-router", name: "Custom Router", package: "@ai-sdk/openai-compatible", integrationID: "9router" },
      ] as ProviderListOutput["data"],
      [
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
      ] as ModelListOutput["data"],
    )

    // The V2 server already filters availability; provider.list output is the
    // authoritative connected set regardless of integration.list state.
    expect(result.connected).toEqual(["anthropic", "custom-router"])
    expect((result.all.get("custom-router") as { integrationID?: string } | undefined)?.integrationID).toBe("9router")
    expect(result.all.get("anthropic")?.models["claude"]).toBeDefined()
    expect(result.all.get("custom-router")?.models["beam"]).toBeDefined()
  })

  test("V2 provider with integrationID alias stays connected even when models are absent", () => {
    const result = normalizeProviderList(
      [{ id: "deepseek-9router", name: "DeepSeek", package: "@ai-sdk/openai-compatible", integrationID: "9router" }] as ProviderListOutput["data"],
      [] as ModelListOutput["data"],
    )
    expect(result.connected).toEqual(["deepseek-9router"])
    expect((result.all.get("deepseek-9router") as { integrationID?: string } | undefined)?.integrationID).toBe("9router")
  })
})

describe("directoryKey", () => {
  test("normalizes slashes", () => {
    expect(String(directoryKey("C:\\Repos\\sst\\opencode"))).toBe("C:/Repos/sst/opencode")
    expect(String(directoryKey("C:/Repos/sst/opencode"))).toBe("C:/Repos/sst/opencode")
  })

  test("preserves backslashes in posix paths", () => {
    expect(String(directoryKey("/tmp/foo\\bar"))).toBe("/tmp/foo\\bar")
  })

  test("trims trailing slashes without breaking roots", () => {
    expect(String(directoryKey("C:/Repos/sst/opencode/"))).toBe("C:/Repos/sst/opencode")
    expect(String(directoryKey("C:/"))).toBe("C:/")
    expect(String(directoryKey("/"))).toBe("/")
  })
})
