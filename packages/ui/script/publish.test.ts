import { describe, expect, test } from "bun:test"
import { validateChannel } from "./publish"

describe("validateChannel", () => {
  test("returns 'dev' if channel is undefined", () => {
    expect(validateChannel(undefined)).toBe("dev")
  })

  test("returns 'dev' if channel is empty string", () => {
    expect(validateChannel("")).toBe("dev")
  })

  test("accepts valid channels", () => {
    expect(validateChannel("dev")).toBe("dev")
    expect(validateChannel("beta")).toBe("beta")
    expect(validateChannel("latest")).toBe("latest")
    expect(validateChannel("canary")).toBe("canary")
  })

  test("throws error for invalid channels", () => {
    expect(() => validateChannel("prod")).toThrow('Invalid OPENCODE_CHANNEL: "prod"')
    expect(() => validateChannel("test")).toThrow('Invalid OPENCODE_CHANNEL: "test"')
  })
})
