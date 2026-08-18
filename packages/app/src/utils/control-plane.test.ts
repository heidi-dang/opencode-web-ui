import { describe, expect, test } from "bun:test"
import { backendToServerConnection, bootstrapToServerConnections, findBootstrapBackend, normalizedBackendUrl, type BootstrapResponse } from "./control-plane"

const bootstrap: BootstrapResponse = {
  backends: [{ id: "srv_1", type: "opencode", name: "Local", endpoint: "http://localhost:4096/", enabled: true, state: "READY", capabilities: {} as never, createdAt: "", updatedAt: "" }],
}

describe("control-plane bootstrap mapping", () => {
  test("maps stable backend IDs into ServerConnection keys", () => {
    const connection = backendToServerConnection(bootstrap.backends[0]!)
    expect(connection.http.id).toBe("srv_1")
    expect(connection.displayName).toBe("Local")
  })

  test("filters disabled backends", () => {
    const value = { ...bootstrap, backends: [...bootstrap.backends, { ...bootstrap.backends[0]!, id: "srv_2", enabled: false }] }
    expect(bootstrapToServerConnections(value)).toHaveLength(1)
  })

  test("matches bootstrap backends by normalized endpoint", () => {
    expect(normalizedBackendUrl("http://localhost:4096/")).toBe("http://localhost:4096")
    expect(findBootstrapBackend(bootstrap, "http://localhost:4096")?.id).toBe("srv_1")
  })
})
