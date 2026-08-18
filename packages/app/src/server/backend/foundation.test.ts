import { describe, expect, test } from "bun:test"
import { encryptCredential, decryptCredential } from "../control-plane/encryption/credentials"
import { EventHub } from "./event-hub"
import { CircuitBreaker } from "./circuit-breaker"
import { normalizeBackendEndpoint } from "./network"
import { assertImmutableBackendIdentity } from "./domain"

describe("control server foundation", () => {
  test("encrypts credentials with an authenticated versioned payload", () => { const key = Buffer.alloc(32, 7).toString("base64"); const encrypted = encryptCredential("secret", key); expect(encrypted.startsWith("v1.")).toBe(true); expect(decryptCredential(encrypted, key)).toBe("secret"); expect(() => decryptCredential(encrypted, Buffer.alloc(32, 8).toString("base64"))).toThrow() })
  test("normalizes endpoints and rejects URL credentials", () => { expect(normalizeBackendEndpoint("https://example.test///")).toBe("https://example.test"); expect(() => normalizeBackendEndpoint("https://user:pass@example.test")).toThrow("UNSAFE_SERVER_URL") })
  test("protects immutable backend identity", () => { const identity = { id: "backend-1", type: "opencode" as const }; expect(() => assertImmutableBackendIdentity(identity, { id: "backend-2" })).toThrow("BACKEND_ID_IMMUTABLE"); expect(() => assertImmutableBackendIdentity(identity, { type: "deepseek-harness" })).toThrow("BACKEND_TYPE_IMMUTABLE") })
  test("recovers an open circuit through a privileged probe", () => { const circuit = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0 }); circuit.failure(true); expect(circuit.canRequest()).toBe(false); expect(circuit.tryRecoveryProbe()).toBe(true); circuit.success(); expect(circuit.canRequest()).toBe(true) })
  test("does not open the circuit for authentication failures", () => { const circuit = new CircuitBreaker({ failureThreshold: 1 }); circuit.failure(false); expect(circuit.snapshot.state).toBe("CLOSED"); expect(circuit.canRequest()).toBe(true) })
  test("permits only one half-open recovery probe", () => { const circuit = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 0, halfOpenMaxProbes: 1 }); circuit.failure(true); expect(circuit.tryRecoveryProbe()).toBe(true); expect(circuit.tryRecoveryProbe()).toBe(false); circuit.failure(true); expect(circuit.snapshot.state).toBe("OPEN") })
  test("tracks and bounds subscribers", async () => { const hub = new EventHub(); const received: string[] = []; hub.subscribe((event) => received.push(event.type), { maxPending: 2, overflow: "coalesce-deltas" }); hub.publish({ id: "1", sequence: 1, backendId: "b", backendType: "opencode", sessionId: "s", type: "MESSAGE_DELTA", timestamp: new Date().toISOString() }); await Promise.resolve(); expect(received).toEqual(["MESSAGE_DELTA"]); expect(hub.metrics().subscribers).toBe(1) })
})
