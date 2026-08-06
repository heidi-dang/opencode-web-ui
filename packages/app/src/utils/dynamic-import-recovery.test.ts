import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { isRecoverableDynamicImportError, createRecoverableDynamicImport } from "./dynamic-import-recovery"

describe("isRecoverableDynamicImportError", () => {
  test("returns true for known browser chunk load errors", () => {
    expect(isRecoverableDynamicImportError(new Error("Failed to fetch dynamically imported module: https://example.com/chunk.js"))).toBe(true)
    expect(isRecoverableDynamicImportError(new Error("TypeError: importing a module script failed"))).toBe(true)
    expect(isRecoverableDynamicImportError(new Error("error loading dynamically imported module"))).toBe(true)
    expect(isRecoverableDynamicImportError(new Error("ChunkLoadError: Loading chunk 123 failed"))).toBe(true)
    expect(isRecoverableDynamicImportError(new Error("CSS chunk load failed"))).toBe(true)
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

  test("returns false if offline", () => {
    const originalNavigator = globalThis.navigator
    Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true })
    expect(isRecoverableDynamicImportError(new Error("Failed to fetch dynamically imported module"))).toBe(false)
    Object.defineProperty(globalThis, "navigator", { value: originalNavigator, configurable: true })
  })
})

describe("createRecoverableDynamicImport", () => {
  let mockStorage: Record<string, string> = {}
  let reloadCalled = false
  const reloadFn = () => { reloadCalled = true }
  
  beforeEach(() => {
    mockStorage = {}
    reloadCalled = false
    const storage = {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, value: string) => { mockStorage[key] = value },
      removeItem: (key: string) => { delete mockStorage[key] },
    }
    Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true })
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "sessionStorage")
  })

  test("successful import clears retry marker", async () => {
    mockStorage["oc_dyn_import_retry:test-build"] = "1"
    const fn = async () => "OK"
    const wrapper = createRecoverableDynamicImport(fn, "test-build", reloadFn)
    const result = await wrapper()
    expect(result).toBe("OK")
    expect(mockStorage["oc_dyn_import_retry:test-build"]).toBeUndefined()
  })

  test("first chunk error triggers reload and sets marker, does not throw immediately", async () => {
    let callCount = 0
    const fn = async () => {
      callCount++
      throw new Error("ChunkLoadError")
    }
    const wrapper = createRecoverableDynamicImport(fn, "test-build", reloadFn)
    
    // wrapper() returns a pending promise, we shouldn't await it otherwise test hangs.
    // We can race it with a timeout to prove it's pending.
    const p = wrapper()
    const timeout = new Promise((resolve) => setTimeout(() => resolve("TIMEOUT"), 10))
    const result = await Promise.race([p, timeout])
    
    expect(result).toBe("TIMEOUT")
    expect(reloadCalled).toBe(true)
    expect(mockStorage["oc_dyn_import_retry:test-build"]).toBe("1")
    expect(callCount).toBe(1)
  })

  test("second chunk error (marker present) throws error to boundary", async () => {
    mockStorage["oc_dyn_import_retry:test-build"] = "1"
    const fn = async () => {
      throw new Error("ChunkLoadError")
    }
    const wrapper = createRecoverableDynamicImport(fn, "test-build", reloadFn)
    
    expect(wrapper()).rejects.toThrow("ChunkLoadError")
    expect(reloadCalled).toBe(false)
  })

  test("unrelated error throws immediately", async () => {
    const fn = async () => {
      throw new Error("Some unrelated error")
    }
    const wrapper = createRecoverableDynamicImport(fn, "test-build", reloadFn)
    
    expect(wrapper()).rejects.toThrow("Some unrelated error")
    expect(reloadCalled).toBe(false)
    expect(mockStorage["oc_dyn_import_retry:test-build"]).toBeUndefined()
  })
})
