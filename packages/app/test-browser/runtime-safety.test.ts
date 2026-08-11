import { describe, expect, test } from "bun:test"
import {
  sanitizeObjectKey,
  safeJsonParse,
  safeUrlParse,
  safeEncodeURIComponent,
  safeDivide,
  safeUnicodeLength,
  safeTruncateString,
  sanitizeInputText,
  sanitizeFileName,
  safeDateParse,
  safeArrayElement,
  safeRound,
  safeStorageSetItem,
  safeReDoSCheck,
  safeSpeechCapabilities,
  safeAriaBoolean,
  safeWebGLContextRestorer,
  createResizeObserverSafe,
} from "../src/utils/runtime-safety"

describe("Runtime Safety Utilities", () => {
  test("sanitizeObjectKey", () => {
    expect(sanitizeObjectKey("validKey")).toBe(true)
    expect(sanitizeObjectKey("__proto__")).toBe(false)
    expect(sanitizeObjectKey("constructor")).toBe(false)
    expect(sanitizeObjectKey("prototype")).toBe(false)
  })

  test("safeJsonParse", () => {
    const valid = '{"foo": "bar"}'
    const invalid = '{"foo": "bar"'
    const pollution = '{"foo": "bar", "__proto__": {"polluted": true}, "constructor": {"a": 1}}'

    expect(safeJsonParse(valid, { fallback: true })).toEqual({ foo: "bar" })
    expect(safeJsonParse(invalid, { fallback: true })).toEqual({ fallback: true })
    
    const parsedPollution = safeJsonParse<any>(pollution, {})
    expect(parsedPollution.foo).toBe("bar")
    expect(Object.prototype.hasOwnProperty.call(parsedPollution, "__proto__")).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(parsedPollution, "constructor")).toBe(false)
  })

  test("safeUrlParse", () => {
    expect(safeUrlParse("https://opencode.ai")).toBeInstanceOf(URL)
    expect(safeUrlParse("invalid-url")).toBeNull()
    expect(safeUrlParse(null)).toBeNull()
  })

  test("safeEncodeURIComponent", () => {
    expect(safeEncodeURIComponent("hello world")).toBe("hello%20world")
    // Should gracefully handle unpaired surrogate
    expect(safeEncodeURIComponent("unpaired\uD800surrogate")).toBe("unpairedsurrogate")
  })

  test("safeDivide", () => {
    expect(safeDivide(10, 2)).toBe(5)
    expect(safeDivide(10, 0)).toBe(0)
    expect(safeDivide(10, 0, 99)).toBe(99)
    expect(safeDivide(NaN, 2)).toBe(0)
  })

  test("safeUnicodeLength", () => {
    expect(safeUnicodeLength("hello")).toBe(5)
    // Multi-byte emojis count as 1 character with Array.from
    expect(safeUnicodeLength("🚀")).toBe(1)
  })

  test("safeTruncateString", () => {
    expect(safeTruncateString("hello", 3)).toBe("hel")
    expect(safeTruncateString("🚀🚀🚀", 2)).toBe("🚀🚀")
  })

  test("sanitizeInputText", () => {
    const raw = "hello\u200Bworld\uFEFF\x00"
    expect(sanitizeInputText(raw)).toBe("helloworld")
  })

  test("sanitizeFileName", () => {
    expect(sanitizeFileName("my/file\\name.txt")).toBe("my_file_name.txt")
    expect(sanitizeFileName("..")).toBe("file")
    expect(sanitizeFileName(".bashrc")).toBe("bashrc")
  })

  test("safeDateParse", () => {
    const valid = "2026-07-26T12:00:00.000Z"
    const invalid = "not-a-date"
    const fallback = new Date(0)

    expect(safeDateParse(valid, fallback).getTime()).toBe(new Date(valid).getTime())
    expect(safeDateParse(invalid, fallback).getTime()).toBe(fallback.getTime())
  })

  test("safeArrayElement", () => {
    const arr = [1, 2, 3]
    expect(safeArrayElement(arr, 1)).toBe(2)
    expect(safeArrayElement(arr, 5, 99)).toBe(99)
    expect(safeArrayElement(null, 0, 99)).toBe(99)
  })

  test("safeRound", () => {
    expect(safeRound(1.005, 2)).toBe(1.01)
    expect(safeRound(1.004, 2)).toBe(1)
  })

  test("safeStorageSetItem", () => {
    const storageMock: any = {
      store: {} as Record<string, string>,
      setItem(key: string, val: string) {
        if (key === "trigger-quota") {
          throw new DOMException("Quota exceeded", "QuotaExceededError")
        }
        this.store[key] = val
      },
      removeItem(key: string) {
        delete this.store[key]
      },
      length: 1,
      key(i: number) {
        return "cache-item"
      }
    }

    expect(safeStorageSetItem(storageMock, "foo", "bar")).toBe(true)
    expect(storageMock.store["foo"]).toBe("bar")
    expect(safeStorageSetItem(storageMock, "trigger-quota", "bar")).toBe(false)
  })

  test("safeReDoSCheck", () => {
    const pattern = /^a+b+$/
    expect(safeReDoSCheck("aaabbb", pattern)).toBe(true)
    expect(safeReDoSCheck("c", pattern)).toBe(false)
  })

  test("safeSpeechCapabilities", () => {
    const caps = safeSpeechCapabilities()
    expect(typeof caps.recognition).toBe("boolean")
    expect(typeof caps.synthesis).toBe("boolean")
  })

  test("safeAriaBoolean", () => {
    expect(safeAriaBoolean(true)).toBe("true")
    expect(safeAriaBoolean("false")).toBe("false")
    expect(safeAriaBoolean(undefined)).toBeUndefined()
  })

  test("safeWebGLContextRestorer", () => {
    let added = 0
    let removed = 0
    const canvasMock = {
      addEventListener(type: string, cb: any) {
        added++
      },
      removeEventListener(type: string, cb: any) {
        removed++
      }
    } as any

    const cleanup = safeWebGLContextRestorer(canvasMock)
    expect(added).toBe(2)
    cleanup()
    expect(removed).toBe(2)
  })

  test("createResizeObserverSafe", () => {
    const obs = createResizeObserverSafe(() => {})
    if (typeof ResizeObserver !== "undefined") {
      expect(obs).toBeInstanceOf(ResizeObserver)
    }
  })
})
