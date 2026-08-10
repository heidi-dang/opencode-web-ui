/**
 * Unit tests for the fallback-safe copyToClipboard utility
 * (packages/ui/src/utils/clipboard.ts).
 */
import { describe, expect, test } from "bun:test"
import { copyToClipboard } from "@opencode-ai/ui/utils/clipboard"

describe("copyToClipboard utility", () => {
  test("uses navigator.clipboard.writeText when available and returns true", async () => {
    let written = ""
    const originalNavigator = globalThis.navigator

    const mockNavigator = {
      clipboard: {
        writeText: async (text: string) => {
          written = text
        },
      },
    }

    Object.defineProperty(globalThis, "navigator", {
      value: mockNavigator,
      writable: true,
      configurable: true,
    })

    try {
      const result = await copyToClipboard("hello world")
      expect(result).toBe(true)
      expect(written).toBe("hello world")
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        writable: true,
        configurable: true,
      })
    }
  })

  test("falls back gracefully to document.execCommand when navigator.clipboard throws", async () => {
    const originalNavigator = globalThis.navigator
    const originalDocument = globalThis.document

    const mockNavigator = {
      clipboard: {
        writeText: async () => {
          throw new Error("Permission denied")
        },
      },
    }

    let execCommandCalled = false
    const mockDocument = {
      createElement: () => ({
        style: {},
        value: "",
        focus: () => {},
        select: () => {},
      }),
      body: {
        appendChild: () => {},
        removeChild: () => {},
      },
      execCommand: (command: string) => {
        if (command === "copy") {
          execCommandCalled = true
          return true
        }
        return false
      },
    }

    Object.defineProperty(globalThis, "navigator", {
      value: mockNavigator,
      writable: true,
      configurable: true,
    })

    Object.defineProperty(globalThis, "document", {
      value: mockDocument,
      writable: true,
      configurable: true,
    })

    try {
      const result = await copyToClipboard("fallback text")
      expect(result).toBe(true)
      expect(execCommandCalled).toBe(true)
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        writable: true,
        configurable: true,
      })
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        writable: true,
        configurable: true,
      })
    }
  })

  test("falls back gracefully when navigator.clipboard is undefined", async () => {
    const originalNavigator = globalThis.navigator
    const originalDocument = globalThis.document

    const mockNavigator = {} // no clipboard property

    let execCommandCalled = false
    const mockDocument = {
      createElement: () => ({
        style: {},
        value: "",
        focus: () => {},
        select: () => {},
      }),
      body: {
        appendChild: () => {},
        removeChild: () => {},
      },
      execCommand: (command: string) => {
        if (command === "copy") {
          execCommandCalled = true
          return true
        }
        return false
      },
    }

    Object.defineProperty(globalThis, "navigator", {
      value: mockNavigator,
      writable: true,
      configurable: true,
    })

    Object.defineProperty(globalThis, "document", {
      value: mockDocument,
      writable: true,
      configurable: true,
    })

    try {
      const result = await copyToClipboard("insecure-context text")
      expect(result).toBe(true)
      expect(execCommandCalled).toBe(true)
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        writable: true,
        configurable: true,
      })
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        writable: true,
        configurable: true,
      })
    }
  })

  test("returns false when both clipboard API and execCommand are unavailable or throw", async () => {
    const originalNavigator = globalThis.navigator
    const originalDocument = globalThis.document

    Object.defineProperty(globalThis, "navigator", {
      value: undefined,
      writable: true,
      configurable: true,
    })

    Object.defineProperty(globalThis, "document", {
      value: undefined,
      writable: true,
      configurable: true,
    })

    try {
      const result = await copyToClipboard("nowhere to copy")
      expect(result).toBe(false)
    } finally {
      Object.defineProperty(globalThis, "navigator", {
        value: originalNavigator,
        writable: true,
        configurable: true,
      })
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        writable: true,
        configurable: true,
      })
    }
  })
})
