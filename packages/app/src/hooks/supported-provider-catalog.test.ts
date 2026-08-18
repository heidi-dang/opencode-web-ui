import { describe, expect, test } from "bun:test"
import {
  normalizeSupportedProviderCatalog,
  providerSearchText,
  type SupportedProviderIntegration,
} from "./supported-provider-catalog"

const integrations = (count: number): SupportedProviderIntegration[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `provider-${index}`,
    name: `Provider ${index}`,
    methods: index === 7 ? [{ type: "oauth" as const, id: "oauth", label: "OAuth" }] : [{ type: "key" as const }],
    connections: index < 3 ? [{ type: "credential" as const, id: `credential-${index}`, label: "Default" }] : [],
  }))

describe("normalizeSupportedProviderCatalog", () => {
  test("keeps every supported provider even when only a subset is connected", () => {
    const catalog = normalizeSupportedProviderCatalog(integrations(80))

    expect(catalog.status).toBe("ready")
    expect(catalog.providers).toHaveLength(80)
    expect(catalog.providers.find((provider) => provider.id === "provider-7")?.connected).toBe(false)
    expect(["provider-0", "provider-1", "provider-2"].every((id) => catalog.providers.find((provider) => provider.id === id)?.connected)).toBe(true)
  })

  test("preserves auth methods and supplies safe fallback metadata", () => {
    const catalog = normalizeSupportedProviderCatalog([
      {
        id: "unlisted-provider",
        name: "",
        methods: [],
        connections: [],
      },
    ])

    expect(catalog.providers[0]).toMatchObject({
      id: "unlisted-provider",
      name: "unlisted-provider",
      methods: [],
      connected: false,
    })
  })

  test("normalizes the v1 provider auth map into the same supported catalog", () => {
    const catalog = normalizeSupportedProviderCatalog(
      {
        anthropic: [{ type: "api", label: "API key" }],
        github: [{ type: "oauth", label: "GitHub" }],
      },
      ["anthropic"],
    )

    expect(catalog.providers).toEqual([
      { id: "anthropic", name: "anthropic", methods: [{ type: "key", label: "API key" }], connections: [], connected: true },
      {
        id: "github",
        name: "github",
        methods: [{ type: "oauth", id: "github-oauth", label: "GitHub" }],
        connections: [],
        connected: false,
      },
    ])
  })

  test("search text includes both provider id and display name", () => {
    expect(providerSearchText({ id: "obscure-ai", name: "Obscure AI" })).toBe("obscure-ai obscure ai")
  })
})
