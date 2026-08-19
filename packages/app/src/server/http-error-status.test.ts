import { describe, expect, test } from "bun:test"
import { controlErrorStatus } from "./http-error-status"

describe("control-plane error status mapping", () => {
  test("maps known client, backend, and circuit errors to safe HTTP classes", () => {
    expect(controlErrorStatus("INVALID_SERVER_URL")).toBe(400)
    expect(controlErrorStatus("UNSAFE_SERVER_URL")).toBe(400)
    expect(controlErrorStatus("SERVER_NOT_FOUND")).toBe(404)
    expect(controlErrorStatus("SERVER_DISABLED")).toBe(409)
    expect(controlErrorStatus("DUPLICATE_SERVER_URL")).toBe(409)
    expect(controlErrorStatus("AUTH_FAILED")).toBe(401)
    expect(controlErrorStatus("BACKEND_CIRCUIT_OPEN")).toBe(503)
    expect(controlErrorStatus("DNS_RESOLUTION_FAILED")).toBe(502)
    expect(controlErrorStatus("GATEWAY_CANNOT_REACH_SERVER")).toBe(502)
    expect(controlErrorStatus("unexpected internal detail")).toBe(500)
  })
})
