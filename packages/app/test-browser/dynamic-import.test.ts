import { describe, expect, test } from "bun:test"
import { isRecoverableDynamicImportError } from "../src/utils/dynamic-import-recovery"

describe("isRecoverableDynamicImportError", () => {
  test("returns true for known browser chunk load errors", () => {
    expect(isRecoverableDynamicImportError(new Error("Failed to fetch dynamically imported module: https://example.com/chunk.js"))).toBe(true)
    expect(isRecoverableDynamicImportError(new Error("TypeError: importing a module script failed"))).toBe(true)
    expect(isRecoverableDynamicImportError(new Error("error loading dynamically imported module"))).toBe(true)
    expect(isRecoverableDynamicImportError(new Error("ChunkLoadError: Loading chunk 123 failed"))).toBe(true)
  })

  test("returns false for unrelated errors", () => {
    expect(isRecoverableDynamicImportError(new Error("Cannot read property 'foo' of undefined"))).toBe(false)
    expect(isRecoverableDynamicImportError(new Error("Failed to fetch API"))).toBe(false)
    expect(isRecoverableDynamicImportError(new Error("Not Authorized"))).toBe(false)
  })

  test("returns false for non-errors", () => {
    expect(isRecoverableDynamicImportError("Failed to fetch dynamically imported module")).toBe(false)
    expect(isRecoverableDynamicImportError(null)).toBe(false)
    expect(isRecoverableDynamicImportError(undefined)).toBe(false)
    expect(isRecoverableDynamicImportError(123)).toBe(false)
  })
})
