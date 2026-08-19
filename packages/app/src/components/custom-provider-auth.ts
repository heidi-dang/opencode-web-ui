type ProviderConfig = {
  npm?: unknown
  models?: unknown
}

export function isCustomProviderConfig(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const config = value as ProviderConfig
  return (
    config.npm === "@ai-sdk/openai-compatible" &&
    !!config.models &&
    typeof config.models === "object" &&
    Object.keys(config.models).length > 0
  )
}

export async function setCustomProviderApiKey(input: {
  providerID: string
  key: string
  setAuth: (input: { providerID: string; auth: { type: "api"; key: string } }) => Promise<unknown>
}) {
  return input.setAuth({
    providerID: input.providerID,
    auth: { type: "api", key: input.key },
  })
}
