const PROVIDER_EXECUTION_METHODS = new Set<PropertyKey>(["switchModel", "prompt", "command", "shell", "compact"])
const wrappedSDKs = new WeakMap<object, object>()

type BackendInstanceClient = {
  instance: {
    dispose: () => Promise<unknown>
  }
}

type BridgeableSDK = {
  readonly url: string
  readonly client: BackendInstanceClient
  readonly api: {
    readonly session: object
  }
}

function isLoopbackHostname(hostname: string) {
  const value = hostname.toLowerCase()
  if (value === "localhost" || value.endsWith(".localhost")) return true
  if (value === "::1" || value === "[::1]") return true
  return /^127(?:\.\d{1,3}){3}$/.test(value)
}

export function isRemoteOpenCodeBackend(url: string) {
  try {
    return !isLoopbackHostname(new URL(url).hostname)
  } catch {
    return false
  }
}

export function providerIDFromExecutionInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  const model = (input as { model?: unknown }).model
  if (!model || typeof model !== "object" || Array.isArray(model)) return
  const providerID = (model as { providerID?: unknown }).providerID
  if (typeof providerID !== "string" || providerID.length === 0) return
  return providerID
}

function createBackendProviderCredentialReloader(client: BackendInstanceClient) {
  const ready = new Set<string>()
  let pending: Promise<void> | undefined

  return async (providerID: string) => {
    if (ready.has(providerID)) return

    if (!pending) {
      const reload = client.instance.dispose().then(() => undefined)
      pending = reload.finally(() => {
        pending = undefined
      })
    }

    await pending
    ready.add(providerID)
  }
}

/**
 * OpenCode owns provider credentials on the backend. A remote browser must not
 * fetch, persist, or forward those secrets itself. Before the first execution
 * for a provider, dispose the directory-scoped OpenCode instance so its normal
 * provider bootstrap reloads credentials already stored on that backend.
 *
 * V2 selects the provider through session.switchModel before the later prompt,
 * and that prompt does not need to repeat model metadata. Treat switchModel as
 * a credential-bearing execution boundary so the reload happens before the
 * backend accepts the selected provider/model.
 */
export function withBackendProviderCredentials<T extends BridgeableSDK>(sdk: T): T {
  if (!isRemoteOpenCodeBackend(sdk.url)) return sdk

  const cached = wrappedSDKs.get(sdk)
  if (cached) return cached as T

  const ensureCredentials = createBackendProviderCredentialReloader(sdk.client)
  const methods = new Map<PropertyKey, unknown>()
  const session = new Proxy(sdk.api.session, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== "function" || !PROVIDER_EXECUTION_METHODS.has(property)) return value

      const cachedMethod = methods.get(property)
      if (cachedMethod) return cachedMethod

      const wrapped = async (...args: unknown[]) => {
        const providerID = providerIDFromExecutionInput(args[0])
        if (providerID) await ensureCredentials(providerID)
        return Reflect.apply(value, target, args)
      }
      methods.set(property, wrapped)
      return wrapped
    },
  })
  const api = new Proxy(sdk.api, {
    get(target, property, receiver) {
      if (property === "session") return session
      return Reflect.get(target, property, receiver)
    },
  })
  const wrapped = new Proxy(sdk, {
    get(target, property, receiver) {
      if (property === "api") return api
      return Reflect.get(target, property, receiver)
    },
  })

  wrappedSDKs.set(sdk, wrapped)
  return wrapped as T
}
