import { describe, expect, test } from "bun:test"
import { validateCustomProvider } from "./dialog-custom-provider-form"

const t = (key: string) => key

const validForm = {
  providerID: "custom-provider",
  name: "Custom Provider",
  baseURL: "https://api.example.com",
  apiKey: "secret",
  models: [{ row: "m0", id: "model-a", name: "Model A", err: {} }],
  headers: [{ row: "h0", key: "", value: "", err: {} }],
  err: {},
}

describe("validateCustomProvider", () => {
  test("builds trimmed config payload", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: " Custom Provider ",
        baseURL: "https://api.example.com ",
        apiKey: " {env: CUSTOM_PROVIDER_KEY} ",
        models: [{ row: "m0", id: " model-a ", name: " Model A ", err: {} }],
        headers: [
          { row: "h0", key: " X-Test ", value: " enabled ", err: {} },
          { row: "h1", key: "", value: "", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })

    expect(result.result).toEqual({
      providerID: "custom-provider",
      name: "Custom Provider",
      key: undefined,
      config: {
        npm: "@ai-sdk/openai-compatible",
        name: "Custom Provider",
        env: ["CUSTOM_PROVIDER_KEY"],
        options: {
          baseURL: "https://api.example.com",
          headers: {
            "X-Test": "enabled",
          },
        },
        models: {
          "model-a": { name: "Model A" },
        },
      },
    })
  })

  test("flags duplicate rows and allows reconnecting disabled providers", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "custom-provider",
        name: "Provider",
        baseURL: "https://api.example.com",
        apiKey: "secret",
        models: [
          { row: "m0", id: "model-a", name: "Model A", err: {} },
          { row: "m1", id: "model-a", name: "Model A 2", err: {} },
        ],
        headers: [
          { row: "h0", key: "Authorization", value: "one", err: {} },
          { row: "h1", key: "authorization", value: "two", err: {} },
        ],
        err: {},
      },
      t,
      disabledProviders: ["custom-provider"],
      existingProviderIDs: new Set(["custom-provider"]),
    })

    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBeUndefined()
    expect(result.models[1]).toEqual({
      id: "provider.custom.error.duplicate",
      name: undefined,
    })
    expect(result.headers[1]).toEqual({
      key: "provider.custom.error.duplicate",
      value: undefined,
    })
  })

  // ── Top-level field validation ────────────────────────────────────────────

  test("empty providerID is required", () => {
    const result = validateCustomProvider({
      form: { ...validForm, providerID: "  " },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBe("provider.custom.error.providerID.required")
  })

  test("invalid providerID format is rejected", () => {
    for (const bad of ["UPPER", "has space", "has/slash", "é"]) {
      const result = validateCustomProvider({
        form: { ...validForm, providerID: bad },
        t,
        disabledProviders: [],
        existingProviderIDs: new Set(),
      })
      expect(result.result).toBeUndefined()
      expect(result.err.providerID).toBe("provider.custom.error.providerID.format")
    }
  })

  test("providerID format allows lowercase, digits, hyphen, underscore", () => {
    for (const good of ["a", "a1", "my-provider", "my_provider", "my-provider_2"]) {
      const result = validateCustomProvider({
        form: { ...validForm, providerID: good },
        t,
        disabledProviders: [],
        existingProviderIDs: new Set(),
      })
      expect(result.result?.providerID).toBe(good)
    }
  })

  test("existing provider ID is rejected when not disabled", () => {
    const result = validateCustomProvider({
      form: { ...validForm, providerID: "openai" },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(["openai"]),
    })
    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBe("provider.custom.error.providerID.exists")
  })

  test("existing provider ID is allowed when disabled (reconnect)", () => {
    const result = validateCustomProvider({
      form: { ...validForm, providerID: "openai" },
      t,
      disabledProviders: ["openai"],
      existingProviderIDs: new Set(["openai"]),
    })
    expect(result.result?.providerID).toBe("openai")
    expect(result.err.providerID).toBeUndefined()
  })

  test("empty name is required", () => {
    const result = validateCustomProvider({
      form: { ...validForm, name: " " },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result).toBeUndefined()
    expect(result.err.name).toBe("provider.custom.error.name.required")
  })

  test("empty baseURL is required", () => {
    const result = validateCustomProvider({
      form: { ...validForm, baseURL: " " },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result).toBeUndefined()
    expect(result.err.baseURL).toBe("provider.custom.error.baseURL.required")
  })

  test("invalid baseURL scheme is rejected", () => {
    for (const bad of ["ftp://example.com", "example.com", "//example.com", "https:/example.com"]) {
      const result = validateCustomProvider({
        form: { ...validForm, baseURL: bad },
        t,
        disabledProviders: [],
        existingProviderIDs: new Set(),
      })
      expect(result.result).toBeUndefined()
      expect(result.err.baseURL).toBe("provider.custom.error.baseURL.format")
    }
  })

  test("valid baseURL with trailing slash is accepted", () => {
    const result = validateCustomProvider({
      form: { ...validForm, baseURL: "https://api.example.com/v1/" },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result?.config.options.baseURL).toBe("https://api.example.com/v1/")
    expect(result.err.baseURL).toBeUndefined()
  })

  // ── API key / env var handling ────────────────────────────────────────────

  test("literal API key is passed through as key", () => {
    const result = validateCustomProvider({
      form: { ...validForm, apiKey: "sk-literal-123" },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result?.key).toBe("sk-literal-123")
    expect(result.result?.config).not.toHaveProperty("env")
    expect(result.err.apiKey).toBeUndefined()
  })

  test("valid env reference is extracted and key is omitted", () => {
    const result = validateCustomProvider({
      form: { ...validForm, apiKey: "{env:MY_API_KEY}" },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result?.key).toBeUndefined()
    expect(result.result?.config.env).toEqual(["MY_API_KEY"])
    expect(result.err.apiKey).toBeUndefined()
  })

  test("empty env reference is rejected (no literal leak)", () => {
    for (const bad of ["{env:}", "{env: }", "{env:   }"]) {
      const result = validateCustomProvider({
        form: { ...validForm, apiKey: bad },
        t,
        disabledProviders: [],
        existingProviderIDs: new Set(),
      })
      expect(result.result).toBeUndefined()
      expect(result.err.apiKey).toBe("provider.custom.error.apiKey.envEmpty")
    }
  })

  test("malformed env name is rejected", () => {
    for (const bad of ["{env:MY KEY}", "{env:1ABC}", "{env:my-key}", "{env:my.key}"]) {
      const result = validateCustomProvider({
        form: { ...validForm, apiKey: bad },
        t,
        disabledProviders: [],
        existingProviderIDs: new Set(),
      })
      expect(result.result).toBeUndefined()
      expect(result.err.apiKey).toBe("provider.custom.error.apiKey.envFormat")
    }
  })

  test("whitespace-trimmed env reference is accepted", () => {
    const result = validateCustomProvider({
      form: { ...validForm, apiKey: "  {env:  MY_API_KEY  }  " },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result?.config.env).toEqual(["MY_API_KEY"])
    expect(result.err.apiKey).toBeUndefined()
  })

  // ── Model rows ────────────────────────────────────────────────────────────

  test("model with empty id is rejected", () => {
    const result = validateCustomProvider({
      form: {
        ...validForm,
        models: [{ row: "m0", id: "  ", name: "Model A", err: {} }],
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result).toBeUndefined()
    expect(result.models[0].id).toBe("provider.custom.error.required")
  })

  test("model with empty name is rejected", () => {
    const result = validateCustomProvider({
      form: {
        ...validForm,
        models: [{ row: "m0", id: "model-a", name: " ", err: {} }],
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result).toBeUndefined()
    expect(result.models[0].name).toBe("provider.custom.error.required")
  })

  test("models with same trimmed id are flagged duplicate", () => {
    const result = validateCustomProvider({
      form: {
        ...validForm,
        models: [
          { row: "m0", id: "model-a", name: "A", err: {} },
          { row: "m1", id: " model-a ", name: "A again", err: {} },
        ],
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result).toBeUndefined()
    expect(result.models[0].id).toBeUndefined()
    expect(result.models[1].id).toBe("provider.custom.error.duplicate")
  })

  test("model ids are trimmed in the resulting config", () => {
    const result = validateCustomProvider({
      form: {
        ...validForm,
        models: [{ row: "m0", id: " model-a ", name: " Model A ", err: {} }],
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result?.config.models).toEqual({ "model-a": { name: "Model A" } })
  })

  // ── Header rows ───────────────────────────────────────────────────────────

  test("header with key but no value is rejected", () => {
    const result = validateCustomProvider({
      form: {
        ...validForm,
        headers: [{ row: "h0", key: "X-Test", value: " ", err: {} }],
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result).toBeUndefined()
    expect(result.headers[0].value).toBe("provider.custom.error.required")
  })

  test("header with value but no key is rejected", () => {
    const result = validateCustomProvider({
      form: {
        ...validForm,
        headers: [{ row: "h0", key: " ", value: "enabled", err: {} }],
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result).toBeUndefined()
    expect(result.headers[0].key).toBe("provider.custom.error.required")
  })

  test("fully empty header rows are ignored (not errors)", () => {
    const result = validateCustomProvider({
      form: {
        ...validForm,
        headers: [
          { row: "h0", key: "", value: "", err: {} },
          { row: "h1", key: " ", value: " ", err: {} },
        ],
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result).toBeDefined()
    expect(result.result?.config.options).not.toHaveProperty("headers")
  })

  test("duplicate header keys are flagged case-insensitively", () => {
    const result = validateCustomProvider({
      form: {
        ...validForm,
        headers: [
          { row: "h0", key: "X-Test", value: "one", err: {} },
          { row: "h1", key: "x-test", value: "two", err: {} },
        ],
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result).toBeUndefined()
    expect(result.headers[0].key).toBeUndefined()
    expect(result.headers[1].key).toBe("provider.custom.error.duplicate")
  })

  test("header values are trimmed in the resulting config", () => {
    const result = validateCustomProvider({
      form: {
        ...validForm,
        headers: [{ row: "h0", key: " X-Test ", value: " enabled ", err: {} }],
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result?.config.options.headers).toEqual({ "X-Test": "enabled" })
  })

  // ── Whole-form edge cases ─────────────────────────────────────────────────

  test("entirely empty form produces all top-level errors", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "",
        name: "",
        baseURL: "",
        apiKey: "",
        models: [{ row: "m0", id: "", name: "", err: {} }],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result).toBeUndefined()
    expect(result.err.providerID).toBe("provider.custom.error.providerID.required")
    expect(result.err.name).toBe("provider.custom.error.name.required")
    expect(result.err.baseURL).toBe("provider.custom.error.baseURL.required")
    expect(result.err.apiKey).toBeUndefined()
    expect(result.models[0].id).toBe("provider.custom.error.required")
    expect(result.models[0].name).toBe("provider.custom.error.required")
  })

  test("minimal valid form succeeds", () => {
    const result = validateCustomProvider({
      form: {
        providerID: "x",
        name: "X",
        baseURL: "https://x.example.com",
        apiKey: "",
        models: [{ row: "m0", id: "m1", name: "M1", err: {} }],
        headers: [{ row: "h0", key: "", value: "", err: {} }],
        err: {},
      },
      t,
      disabledProviders: [],
      existingProviderIDs: new Set(),
    })
    expect(result.result).toBeDefined()
    expect(result.result?.config.models).toEqual({ m1: { name: "M1" } })
    expect(result.result?.config.options.baseURL).toBe("https://x.example.com")
    expect(result.result?.key).toBeUndefined()
    expect(result.result?.config).not.toHaveProperty("env")
  })

  test("duplicate providerID in disabled list is not double-flagged", () => {
    const result = validateCustomProvider({
      form: { ...validForm, providerID: "openai" },
      t,
      disabledProviders: ["openai", "openai"],
      existingProviderIDs: new Set(["openai"]),
    })
    expect(result.result?.providerID).toBe("openai")
    expect(result.err.providerID).toBeUndefined()
  })
})
