import { describe, expect, test } from "bun:test"
import { bootstrapToServerConnections, findBootstrapBackend, normalizedBackendUrl } from "./control-plane"
import { parseControlPlaneHealth, type ControlPlaneHealthResponse } from "./control-plane-contract"

describe("control-plane bootstrap", () => {
  test("maps stable backend ids without credentials", () => {
    const result = bootstrapToServerConnections({ backends: [{ id: "b-1", endpoint: "http://127.0.0.1:4096/", name: "Local", enabled: true }] })
    expect(result).toEqual([{ type: "http", displayName: "Local", http: { id: "b-1", url: "http://127.0.0.1:4096/" } }])
  })

  test("matches legacy URLs after normalization", () => {
    const response = { backends: [{ id: "b-1", endpoint: "https://example.test/api/", enabled: true }] }
    expect(findBootstrapBackend(response, "https://example.test/api")).toMatchObject({ id: "b-1" })
    expect(normalizedBackendUrl("https://example.test/api/?token=ignored#fragment")).toBe("https://example.test/api")
  })

  test("does not throw when a persisted backend URL is empty", () => {
    expect(normalizedBackendUrl("")).toBeUndefined()
  })

  test("skips malformed enabled backend records", () => {
    expect(bootstrapToServerConnections({ backends: [{ id: "broken", endpoint: "", enabled: true }] })).toEqual([])
  })

  test("excludes disabled backends from active connections", () => {
    expect(bootstrapToServerConnections({ backends: [{ id: "b-1", endpoint: "http://localhost:4096", enabled: false }] })).toEqual([])
  })
})

describe("control-plane health contract", () => {
  const response: ControlPlaneHealthResponse = {
    server: {
      id: "srv-1",
      name: "Test",
      endpoint: "http://example.test",
      enabled: true,
      state: "READY",
    },
    state: "READY",
    protocol: "v2",
    reachable: true,
    authenticated: true,
    healthy: true,
    latencyMs: 12,
    checkedAt: "2026-08-19T00:00:00.000Z",
  }

  test("accepts the canonical flattened health response", () => {
    expect(parseControlPlaneHealth(response)).toEqual(response)
  })

  test("does not turn a malformed health response into an offline backend", () => {
    expect(parseControlPlaneHealth({ server: response.server, healthy: true })).toMatchObject({
      error: "CONTROL_PLANE_CONTRACT_INVALID",
      healthy: false,
      reachable: false,
      authenticated: false,
    })
  })
})
