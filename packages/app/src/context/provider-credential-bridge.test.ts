import { describe, expect, test } from "bun:test"
import { isRemoteOpenCodeBackend, providerIDFromExecutionInput, withBackendProviderCredentials } from "./provider-credential-bridge"

type ExecutionInput = { model?: { providerID?: string; provider?: string }; providerID?: string; provider?: string }

function fakeSDK(input: {
  url?: string
  dispose?: () => Promise<unknown>
  onExecute?: (method: string, value: ExecutionInput) => void
}) {
  const execute = (method: string) => async (value: ExecutionInput) => {
    input.onExecute?.(method, value)
    return method
  }
  return {
    url: input.url ?? "http://100.64.0.10:4096",
    client: {
      instance: {
        dispose: input.dispose ?? (async () => true),
      },
    },
    api: {
      session: {
        switchModel: execute("switchModel"),
        prompt: execute("prompt"),
        command: execute("command"),
        shell: execute("shell"),
        compact: execute("compact"),
        create: execute("create"),
      },
    },
  }
}

describe("backend provider credential bridge", () => {
  test("classifies loopback servers as local and private or named hosts as remote", () => {
    expect(isRemoteOpenCodeBackend("http://localhost:4096")).toBe(false)
    expect(isRemoteOpenCodeBackend("http://127.0.0.2:4096")).toBe(false)
    expect(isRemoteOpenCodeBackend("http://[::1]:4096")).toBe(false)
    expect(isRemoteOpenCodeBackend("http://100.64.0.10:4096")).toBe(true)
    expect(isRemoteOpenCodeBackend("https://opencode-node.example.test")).toBe(true)
    expect(isRemoteOpenCodeBackend("not a url")).toBe(false)
  })

  test("extracts provider ID from various execution input structures", () => {
    expect(providerIDFromExecutionInput({ model: { providerID: "anthropic" } })).toBe("anthropic")
    expect(providerIDFromExecutionInput({ model: { provider: "openai" } })).toBe("openai")
    expect(providerIDFromExecutionInput({ providerID: "9router" })).toBe("9router")
    expect(providerIDFromExecutionInput({ provider: "deepseek" })).toBe("deepseek")
    expect(providerIDFromExecutionInput({})).toBeUndefined()
    expect(providerIDFromExecutionInput(null)).toBeUndefined()
    expect(providerIDFromExecutionInput("invalid")).toBeUndefined()
  })

  test("reloads backend-owned credentials before the first remote provider execution", async () => {
    const events: string[] = []
    const raw = fakeSDK({
      dispose: async () => {
        events.push("dispose")
        return true
      },
      onExecute: (method, value) => events.push(`${method}:${value.model?.providerID}`),
    })
    const sdk = withBackendProviderCredentials(raw)

    await sdk.api.session.prompt({ model: { providerID: "router" } })

    expect(events).toEqual(["dispose", "prompt:router"])
  })

  test("reloads backend-owned credentials on model switch before a model-less prompt", async () => {
    const events: string[] = []
    const raw = fakeSDK({
      dispose: async () => {
        events.push("dispose")
        return true
      },
      onExecute: (method, value) => events.push(`${method}:${value.model?.providerID}`),
    })
    const sdk = withBackendProviderCredentials(raw)

    await sdk.api.session.switchModel({ model: { providerID: "router" } })
    await sdk.api.session.prompt({})

    expect(events).toEqual(["dispose", "switchModel:router", "prompt:undefined"])
  })

  test("reloads backend-owned credentials on session create with provider/model", async () => {
    const events: string[] = []
    const raw = fakeSDK({
      dispose: async () => {
        events.push("dispose")
        return true
      },
      onExecute: (method, value) => events.push(`${method}:${value.model?.providerID}`),
    })
    const sdk = withBackendProviderCredentials(raw)

    await sdk.api.session.create({ model: { providerID: "anthropic" } })

    expect(events).toEqual(["dispose", "create:anthropic"])
  })

  test("reloads once per provider for a directory SDK", async () => {
    let disposals = 0
    const raw = fakeSDK({
      dispose: async () => {
        disposals++
        return true
      },
    })
    const sdk = withBackendProviderCredentials(raw)

    await sdk.api.session.prompt({ model: { providerID: "router" } })
    await sdk.api.session.command({ model: { providerID: "router" } })
    await sdk.api.session.prompt({ model: { providerID: "openai" } })

    expect(disposals).toBe(2)
  })

  test("deduplicates concurrent backend credential reloads", async () => {
    let disposals = 0
    let release: (() => void) | undefined
    let started: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const disposeStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const raw = fakeSDK({
      dispose: async () => {
        disposals++
        started?.()
        await gate
        return true
      },
    })
    const sdk = withBackendProviderCredentials(raw)

    const first = sdk.api.session.prompt({ model: { providerID: "router" } })
    const second = sdk.api.session.command({ model: { providerID: "openai" } })
    await disposeStarted
    expect(disposals).toBe(1)
    release?.()
    await Promise.all([first, second])
    expect(disposals).toBe(1)
  })

  test("does not cache a failed backend credential reload", async () => {
    let disposals = 0
    let executions = 0
    const raw = fakeSDK({
      dispose: async () => {
        disposals++
        if (disposals === 1) throw new Error("reload failed")
        return true
      },
      onExecute: () => {
        executions++
      },
    })
    const sdk = withBackendProviderCredentials(raw)

    await expect(sdk.api.session.prompt({ model: { providerID: "router" } })).rejects.toThrow("reload failed")
    expect(executions).toBe(0)

    await sdk.api.session.prompt({ model: { providerID: "router" } })
    expect(disposals).toBe(2)
    expect(executions).toBe(1)
  })

  test("leaves loopback OpenCode SDKs unchanged", async () => {
    let disposals = 0
    const raw = fakeSDK({
      url: "http://127.0.0.1:4096",
      dispose: async () => {
        disposals++
        return true
      },
    })
    const sdk = withBackendProviderCredentials(raw)

    expect(sdk).toBe(raw)
    await sdk.api.session.prompt({ model: { providerID: "router" } })
    expect(disposals).toBe(0)
  })
})
