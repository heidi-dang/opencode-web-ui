import { describe, expect, test } from "bun:test"
import { serializeControlPlaneHealth, serializeRegistration } from "./control-plane-contract"

const server = {
  id: "srv-1",
  type: "opencode",
  name: "Test",
  endpoint: "http://example.test",
  enabled: true,
  state: "READY" as const,
  protocol: "v2",
  capabilities: { projects: true },
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
}

const health = {
  backendId: "srv-1",
  protocol: "v2" as const,
  reachable: true,
  authenticated: true,
  healthy: true,
  latencyMs: 12,
  checkedAt: "2026-08-19T00:00:01.000Z",
}

describe("control-plane HTTP serializers", () => {
  test("flattens health fields beside the safe server descriptor", () => {
    expect(serializeControlPlaneHealth(server, health)).toEqual({
      server,
      state: "READY",
      protocol: "v2",
      reachable: true,
      authenticated: true,
      healthy: true,
      latencyMs: 12,
      error: undefined,
      checkedAt: "2026-08-19T00:00:01.000Z",
    })
  })

  test("marks registration ready from canonical health fields", () => {
    expect(serializeRegistration(server, health)).toMatchObject({
      ready: true,
      reachability: "SERVER_READY",
      probe: { state: "READY", healthy: true, protocol: "v2" },
    })
  })
})
