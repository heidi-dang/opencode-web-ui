import { describe, expect, test } from "bun:test"
import { bootstrapToServerConnections, findBootstrapBackend, normalizedBackendUrl } from "./control-plane"

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
